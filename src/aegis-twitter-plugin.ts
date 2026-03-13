import type { Plugin } from '@elizaos/core';
import {
    type IAgentRuntime,
    ModelType,
    Service,
    logger,
} from '@elizaos/core';
import { TwitterApi } from 'twitter-api-v2';
import {
    fetchAegisBriefing,
    fetchIndividualBriefing,
    type AegisBriefingResponse,
    type AegisBriefingItem,
    type AegisGlobalBriefing,
    type AegisGlobalContributorItem,
} from './aegis-briefing-plugin.ts';

// Suppress AI SDK warnings that flood Railway logs
(globalThis as any).AI_SDK_LOG_WARNINGS = false;

// ============================================
// Configuration
// ============================================
const TWITTER_POST_CONFIG = {
    // Interval between Aegis briefing tweets (in minutes)
    INTERVAL_MIN: parseInt(process.env.AEGIS_TWEET_INTERVAL_MIN || '120', 10),
    INTERVAL_MAX: parseInt(process.env.AEGIS_TWEET_INTERVAL_MAX || '240', 10),
    // Whether to post immediately on startup (for testing)
    POST_ON_STARTUP: process.env.AEGIS_TWEET_ON_STARTUP === 'true',
    // Max tweet length (Twitter supports up to 280, or longer with Twitter Blue)
    MAX_TWEET_LENGTH: parseInt(process.env.AEGIS_TWEET_MAX_LENGTH || '280', 10),
    // Enable/disable (master switch)
    ENABLED: process.env.AEGIS_TWEET_ENABLED !== 'false',
    // Dry run — log tweets without actually posting
    DRY_RUN: process.env.AEGIS_TWEET_DRY_RUN === 'true',
};

// ============================================
// Timeout utility
// ============================================

/**
 * Wrap a promise with a timeout. Rejects with an error if the promise
 * does not settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

// ============================================
// Tweet Formatting
// ============================================

function isGlobalBriefing(data: AegisBriefingResponse): data is AegisGlobalBriefing {
    return 'type' in data && (data as any).type === 'global';
}

/**
 * Clean a title from scraped web content.
 * Removes navigation text, excessive whitespace, and truncates at first newline.
 */
function cleanTitle(raw: string): string {
    // Take only the first line (scraped titles often include nav text after newline)
    let title = raw.split('\n')[0].trim();
    // Remove common scraped artifacts
    title = title
        .replace(/Skip to content.*$/i, '')
        .replace(/Navigation.*$/i, '')
        .replace(/\s*[·|–—-]\s*GitHub\s*$/i, '')  // "Title · GitHub" → "Title"
        .replace(/\s{2,}/g, ' ')  // collapse multiple spaces
        .trim();
    // Limit to reasonable tweet title length
    if (title.length > 150) {
        title = title.slice(0, 147) + '...';
    }
    return title || raw.split('\n')[0].trim().slice(0, 100);
}

/**
 * Pick the best un-tweeted item from a briefing.
 * Skips items that have already been tweeted, falling through to the
 * next-highest-scored item. Returns null only when ALL items are exhausted.
 */
function pickBestItem(briefing: AegisBriefingResponse): {
    title: string;
    topics: string[];
    score: number;
    sourceUrl?: string;
    content?: string;
    contributorPrincipal?: string;
} | null {
    if (isGlobalBriefing(briefing)) {
        const allItems: { item: AegisGlobalContributorItem; principal: string }[] = [];
        for (const c of briefing.contributors) {
            for (const item of c.topItems) {
                allItems.push({ item, principal: c.principal });
            }
        }
        if (allItems.length === 0) return null;
        allItems.sort((a, b) => b.item.briefingScore - a.item.briefingScore);

        // Pick the highest-scored item that hasn't been tweeted yet
        for (const entry of allItems) {
            const title = cleanTitle(entry.item.title);
            if (!wasTweeted(title)) {
                return {
                    title,
                    topics: entry.item.topics,
                    score: entry.item.briefingScore,
                    sourceUrl: (entry.item as any).sourceUrl || undefined,
                    contributorPrincipal: entry.principal,
                };
            }
        }
        logger.info(`[AegisTwitter] All ${allItems.length} items already tweeted`);
        return null;
    } else {
        if (!briefing.items || briefing.items.length === 0) return null;
        const sorted = [...briefing.items].sort(
            (a, b) => b.briefingScore - a.briefingScore
        );

        for (const item of sorted) {
            const title = cleanTitle(item.title);
            if (!wasTweeted(title)) {
                return {
                    title,
                    topics: item.topics,
                    score: item.briefingScore,
                    sourceUrl: item.sourceUrl,
                    content: item.content,
                };
            }
        }
        logger.info(`[AegisTwitter] All ${sorted.length} items already tweeted`);
        return null;
    }
}

// ============================================
// LLM-based Tweet Commentary Generation
// ============================================

/**
 * Generate a concise analytical commentary for a briefing item using the LLM.
 * Returns an empty string on failure (caller should handle fallback).
 */
async function generateCommentary(
    runtime: IAgentRuntime,
    item: {
        title: string;
        content?: string;
        topics: string[];
        score: number;
    },
): Promise<string> {
    try {
        const contentSnippet = item.content
            ? item.content.slice(0, 500)
            : '(no article content available)';

        const prompt = `You are Coo, a Web3 technical advisor. Write a single concise tweet-length commentary (max 90 characters) about the article below. Provide an insightful take — what it means, why it matters, or a strategic angle. Do NOT be promotional. Do NOT mention "Aegis" or "D2A". Match the language of the title (if Japanese, write in Japanese; if English, write in English).

Title: ${item.title}
Content: ${contentSnippet}
Topics: ${item.topics.join(', ')}
Quality Score: ${item.score.toFixed(1)}/10

Reply with ONLY the commentary line. No quotes, no prefixes, no hashtags.`;

        const result = await withTimeout(
            runtime.useModel(ModelType.TEXT_SMALL, {
                prompt,
                maxTokens: 80,
                temperature: 0.7,
            }),
            30_000,
            'LLM commentary',
        );

        if (!result || typeof result !== 'string') {
            logger.warn('[AegisTwitter] LLM returned empty/invalid commentary');
            return '';
        }

        // Clean up: remove quotes, known prefixes, excess whitespace
        let commentary = result
            .trim()
            .replace(/^["'「『]|["'」』]$/g, '')  // strip wrapping quotes
            .replace(/^(Commentary|Comment|Analysis|Take|Insight|コメント|分析)[:\s：]*/i, '')  // strip prefixes
            .trim();

        // Hard-truncate if too long
        if (commentary.length > 100) {
            commentary = commentary.slice(0, 97) + '...';
        }

        logger.info(`[AegisTwitter] LLM commentary (${commentary.length} chars): "${commentary}"`);
        return commentary;
    } catch (error: any) {
        logger.warn(`[AegisTwitter] LLM commentary generation failed: ${error.message}`);
        return '';
    }
}

/**
 * Format an Aegis briefing item as a tweet with optional LLM commentary.
 */
function formatTweet(item: {
    title: string;
    topics: string[];
    score: number;
    sourceUrl?: string;
    content?: string;
}, commentary: string = ''): string {
    const maxLen = TWITTER_POST_CONFIG.MAX_TWEET_LENGTH;

    // Build hashtags from topics (up to 3)
    const hashtags = item.topics
        .slice(0, 3)
        .map(t => `#${t.replace(/[^a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '')}`)
        .join(' ');

    const link = item.sourceUrl
        ? `\n${item.sourceUrl}`
        : `\nhttps://aegis.dwebxr.xyz`;

    // Build tweet: title + commentary (if available) + hashtags + link
    const buildTweet = (title: string, comment: string, tags: string) => {
        const parts = [title];
        if (comment) parts.push(comment);
        if (tags) parts.push(tags);
        return parts.join('\n\n') + link;
    };

    // Try with full title + commentary + hashtags
    let tweet = buildTweet(item.title, commentary, hashtags);

    // If too long, try truncating commentary first
    if (tweet.length > maxLen && commentary) {
        const overhead = tweet.length - commentary.length;
        const availableForComment = maxLen - overhead - 3;
        if (availableForComment > 20) {
            tweet = buildTweet(item.title, commentary.slice(0, availableForComment) + '...', hashtags);
        } else {
            // Drop commentary entirely
            tweet = buildTweet(item.title, '', hashtags);
        }
    }

    // If still too long, drop hashtags
    if (tweet.length > maxLen) {
        tweet = buildTweet(item.title, commentary, '');
    }

    // If still too long, truncate title
    if (tweet.length > maxLen) {
        const overhead = tweet.length - item.title.length;
        const availableForTitle = maxLen - overhead - 3;
        tweet = buildTweet(item.title.slice(0, availableForTitle) + '...', commentary, '');
    }

    // Last resort: title + link only
    if (tweet.length > maxLen) {
        const titleOnly = item.title + link;
        if (titleOnly.length > maxLen) {
            const available = maxLen - link.length - 3;
            tweet = item.title.slice(0, available) + '...' + link;
        } else {
            tweet = titleOnly;
        }
    }

    return tweet.trim();
}

// ============================================
// Track recently tweeted titles to avoid duplicates
// Entries track timestamp so we can enforce a minimum re-post gap.
// ============================================
const MIN_REPOST_GAP_MS = 6 * 60 * 60 * 1000; // 6 hours minimum between re-posting same item
const recentlyTweeted = new Map<string, number>(); // title → timestamp
const MAX_RECENT = 100;

function markAsTweeted(title: string): void {
    recentlyTweeted.set(title, Date.now());
    // Cap size by removing oldest entries
    if (recentlyTweeted.size > MAX_RECENT) {
        const oldest = recentlyTweeted.keys().next().value;
        if (oldest) recentlyTweeted.delete(oldest);
    }
}

function wasTweeted(title: string): boolean {
    const ts = recentlyTweeted.get(title);
    if (ts === undefined) return false;
    // Allow re-posting after the minimum gap
    if (Date.now() - ts > MIN_REPOST_GAP_MS) {
        recentlyTweeted.delete(title);
        return false;
    }
    return true;
}

/**
 * Clear all entries from recentlyTweeted that are older than MIN_REPOST_GAP_MS.
 * Returns the number of entries cleared.
 */
function expireOldTweets(): number {
    const now = Date.now();
    let cleared = 0;
    for (const [title, ts] of recentlyTweeted) {
        if (now - ts > MIN_REPOST_GAP_MS) {
            recentlyTweeted.delete(title);
            cleared++;
        }
    }
    return cleared;
}

// ============================================
// Service: Aegis Twitter Poster (Direct twitter-api-v2)
// ============================================

// Module-level interval handle so it persists even if service instance
// gets garbage-collected or stop() is called by the framework.
let globalIntervalHandle: ReturnType<typeof setInterval> | null = null;
let globalRuntime: IAgentRuntime | null = null;
let globalTwitterClient: TwitterApi | null = null;
let globalInitError: string | null = null;
let isPostingInProgress = false;
let cycleCount = 0;
let consecutive503Count = 0;  // Track consecutive 503 errors
const MAX_503_RETRIES = 2;    // Max one-off retries for 503

/**
 * Try to (re-)initialize the Twitter client if it's not available.
 */
function tryInitClient(runtime: IAgentRuntime): boolean {
    if (globalTwitterClient) return true;

    const apiKey = runtime.getSetting('TWITTER_API_KEY');
    const apiSecretKey = runtime.getSetting('TWITTER_API_SECRET_KEY');
    const accessToken = runtime.getSetting('TWITTER_ACCESS_TOKEN');
    const accessTokenSecret = runtime.getSetting('TWITTER_ACCESS_TOKEN_SECRET');

    if (!apiKey || !apiSecretKey || !accessToken || !accessTokenSecret) {
        return false;
    }

    try {
        globalTwitterClient = new TwitterApi({
            appKey: apiKey,
            appSecret: apiSecretKey,
            accessToken: accessToken,
            accessSecret: accessTokenSecret,
        });
        globalInitError = null;
        logger.info('[AegisTwitter] Twitter client re-initialized successfully');
        return true;
    } catch (error: any) {
        globalInitError = error.message;
        logger.warn(`[AegisTwitter] Twitter re-init failed: ${error.message}`);
        return false;
    }
}

/**
 * Core tweet posting logic. Called by the interval timer.
 */
async function postBriefingTweet(runtime: IAgentRuntime): Promise<void> {
    let currentItemTitle: string | null = null;
    try {
        // Heartbeat / diagnostic log every cycle
        cycleCount++;
        logger.info(`[AegisTwitter] === Cycle #${cycleCount} | tweeted=${recentlyTweeted.size} items tracked | client=${globalTwitterClient ? 'ready' : 'null'} ===`);

        logger.info('[AegisTwitter] Fetching briefing for tweet...');
        const briefing = await withTimeout(
            fetchAegisBriefing(),
            30_000,
            'Aegis briefing fetch',
        );

        // Count total available items for diagnostics
        let totalItems = 0;
        if (isGlobalBriefing(briefing)) {
            for (const c of briefing.contributors) {
                totalItems += c.topItems.length;
            }
        } else if (briefing.items) {
            totalItems = briefing.items.length;
        }

        let item = pickBestItem(briefing);

        // If all items exhausted, expire old entries and retry
        if (!item) {
            const cleared = expireOldTweets();
            logger.info(`[AegisTwitter] All ${totalItems} items already tweeted. Expired ${cleared} old entries, retrying...`);
            item = pickBestItem(briefing);
        }

        // Still nothing? Clear ALL history and pick top item
        if (!item) {
            logger.info(`[AegisTwitter] Still no items after expiry. Clearing all ${recentlyTweeted.size} entries.`);
            recentlyTweeted.clear();
            item = pickBestItem(briefing);
        }

        if (!item) {
            logger.warn(`[AegisTwitter] No items in briefing at all (totalItems=${totalItems})`);
            return;
        }
        currentItemTitle = item.title;

        // If we have a contributor principal, fetch the individual briefing
        // for sourceUrl and content (used for LLM commentary)
        if (item.contributorPrincipal) {
            try {
                const indBriefing = await withTimeout(
                    fetchIndividualBriefing(item.contributorPrincipal),
                    30_000,
                    'Individual briefing fetch',
                );
                if (indBriefing?.items) {
                    const normalizeTitle = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
                    const matchedItem = indBriefing.items.find(
                        i => normalizeTitle(i.title) === normalizeTitle(item!.title)
                    );
                    if (matchedItem) {
                        if (matchedItem.sourceUrl && !item.sourceUrl) {
                            item.sourceUrl = matchedItem.sourceUrl;
                            logger.info(`[AegisTwitter] Found sourceUrl: ${matchedItem.sourceUrl}`);
                        }
                        if (matchedItem.content && !item.content) {
                            item.content = matchedItem.content;
                            logger.info(`[AegisTwitter] Found content (${matchedItem.content.length} chars)`);
                        }
                    }
                }
            } catch (error: any) {
                logger.warn(`[AegisTwitter] Individual briefing fetch failed: ${error.message}`);
            }
        }

        logger.info(`[AegisTwitter] Selected: "${item.title.slice(0, 60)}..." score=${item.score} url=${item.sourceUrl || 'none'}`);

        // Generate LLM commentary for the briefing item
        const commentary = await generateCommentary(runtime, item);

        const tweet = formatTweet(item, commentary);

        if (TWITTER_POST_CONFIG.DRY_RUN) {
            logger.info(`[AegisTwitter] DRY RUN (${tweet.length} chars):\n${tweet}`);
            markAsTweeted(item.title);
            return;
        }

        // Ensure Twitter client is available
        if (!globalTwitterClient) {
            const ok = tryInitClient(runtime);
            if (!ok) {
                logger.warn(`[AegisTwitter] No Twitter client — last error: ${globalInitError || 'unknown'}`);
                return;
            }
        }

        // Post tweet
        const result = await globalTwitterClient!.v2.tweet({ text: tweet });
        markAsTweeted(item.title);
        consecutive503Count = 0;  // Reset on success

        const tweetId = result.data?.id;
        logger.info(`[AegisTwitter] Posted tweet${tweetId ? ` id=${tweetId}` : ''} (${tweet.length} chars)`);
    } catch (error: any) {
        logger.error(`[AegisTwitter] Failed to post: ${error.message}`);
        let apiDetail = '';
        if (error.data) {
            try {
                apiDetail = JSON.stringify(error.data);
                logger.error(`[AegisTwitter] API response: ${apiDetail}`);
            } catch { /* ignore */ }
        }
        if (error.code === 403) {
            if (apiDetail.includes('duplicate') || apiDetail.includes('Duplicate')) {
                logger.warn('[AegisTwitter] 403 duplicate — marking item as tweeted');
                if (currentItemTitle) markAsTweeted(currentItemTitle);
            } else {
                logger.error('[AegisTwitter] 403 Forbidden — check app permissions (Read and Write required)');
            }
        } else if (error.code === 401) {
            globalTwitterClient = null;
            globalInitError = error.message;
            logger.warn('[AegisTwitter] 401 Unauthorized — will retry client init next cycle');
        } else if (error.code === 429) {
            logger.warn('[AegisTwitter] 429 Rate limited — will retry next cycle');
        } else if (error.code === 503 || error.status === 503 || error.message?.includes('503')) {
            consecutive503Count++;
            if (consecutive503Count <= MAX_503_RETRIES) {
                const delayMin = consecutive503Count * 10;  // 10min, 20min
                logger.warn(`[AegisTwitter] 503 Service Unavailable (${consecutive503Count}/${MAX_503_RETRIES}) — retry in ${delayMin} min`);
                setTimeout(() => {
                    intervalTick().catch((e) => {
                        logger.error(`[AegisTwitter] 503 retry failed: ${e.message}`);
                    });
                }, delayMin * 60 * 1000);
            } else {
                logger.error(`[AegisTwitter] 503 persists after ${MAX_503_RETRIES} retries — waiting for next scheduled cycle. Check Twitter API status or Developer account.`);
            }
        }
    }
}

/**
 * The interval callback. Guards against overlapping executions.
 */
async function intervalTick(): Promise<void> {
    if (isPostingInProgress) {
        logger.info('[AegisTwitter] Previous cycle still in progress, skipping');
        return;
    }
    if (!globalRuntime) {
        logger.warn('[AegisTwitter] No runtime available, skipping cycle');
        return;
    }
    isPostingInProgress = true;
    try {
        await postBriefingTweet(globalRuntime);
    } catch (error: any) {
        logger.error(`[AegisTwitter] Unhandled error in cycle: ${error.message}`);
    } finally {
        isPostingInProgress = false;
    }
}

export class AegisTwitterService extends Service {
    static serviceType = 'aegis-twitter';
    capabilityDescription = 'Posts Aegis D2A briefing highlights to Twitter/X periodically';

    static async start(runtime: IAgentRuntime): Promise<AegisTwitterService> {
        const service = new AegisTwitterService(runtime);

        if (!TWITTER_POST_CONFIG.ENABLED) {
            logger.info('[AegisTwitter] Disabled via AEGIS_TWEET_ENABLED=false');
            return service;
        }

        // Check that Twitter credentials are available
        const apiKey = runtime.getSetting('TWITTER_API_KEY');
        const apiSecretKey = runtime.getSetting('TWITTER_API_SECRET_KEY');
        const accessToken = runtime.getSetting('TWITTER_ACCESS_TOKEN');
        const accessTokenSecret = runtime.getSetting('TWITTER_ACCESS_TOKEN_SECRET');

        if (!apiKey || !apiSecretKey || !accessToken || !accessTokenSecret) {
            const missing = [];
            if (!apiKey) missing.push('TWITTER_API_KEY');
            if (!apiSecretKey) missing.push('TWITTER_API_SECRET_KEY');
            if (!accessToken) missing.push('TWITTER_ACCESS_TOKEN');
            if (!accessTokenSecret) missing.push('TWITTER_ACCESS_TOKEN_SECRET');
            logger.warn(`[AegisTwitter] Missing credentials: ${missing.join(', ')} — will not post`);
            return service;
        }

        // Initialize twitter-api-v2 client (module-level so it survives stop() calls)
        logger.info('[AegisTwitter] Creating Twitter API v2 client...');
        globalTwitterClient = new TwitterApi({
            appKey: apiKey,
            appSecret: apiSecretKey,
            accessToken: accessToken,
            accessSecret: accessTokenSecret,
        });
        globalRuntime = runtime;
        logger.info('[AegisTwitter] Twitter client created');

        // Clear any previous interval (in case start() is called multiple times)
        if (globalIntervalHandle) {
            clearInterval(globalIntervalHandle);
            globalIntervalHandle = null;
        }

        // Use a fixed interval. Average of min/max, converted to ms.
        const intervalMs = ((TWITTER_POST_CONFIG.INTERVAL_MIN + TWITTER_POST_CONFIG.INTERVAL_MAX) / 2) * 60 * 1000;

        if (TWITTER_POST_CONFIG.POST_ON_STARTUP) {
            // Post immediately (with small delay for other services to init)
            setTimeout(() => intervalTick(), 10_000);
        }

        // Start the repeating interval — this is independent of the service instance
        globalIntervalHandle = setInterval(() => {
            intervalTick().catch((e) => {
                logger.error(`[AegisTwitter] Interval tick error: ${e.message}`);
            });
        }, intervalMs);

        logger.info(
            `[AegisTwitter] Started — interval every ${(intervalMs / 60000).toFixed(0)} min` +
            `${TWITTER_POST_CONFIG.DRY_RUN ? ' (DRY RUN)' : ''}` +
            `${TWITTER_POST_CONFIG.POST_ON_STARTUP ? ' (posting on startup)' : ''}` +
            ` — client ready`
        );

        return service;
    }

    static async stop(_runtime: IAgentRuntime): Promise<void> {
        // Intentionally do NOT clear the interval here.
        // ElizaOS may call this during lifecycle events, and we want
        // the interval to keep running.
        logger.info('[AegisTwitter] static stop() called (interval continues)');
    }

    async stop(): Promise<void> {
        // Log but keep the interval running. The interval is module-level
        // and should persist even if the framework disposes the service instance.
        logger.info('[AegisTwitter] instance stop() called (interval continues)');
        // Log stack trace so we can diagnose who/what called stop()
        logger.info(`[AegisTwitter] stop() caller stack: ${new Error().stack?.split('\n').slice(1, 4).join(' <- ')}`);
    }
}

// ============================================
// Plugin Export
// ============================================
export const aegisTwitterPlugin: Plugin = {
    name: 'aegis-twitter',
    description:
        'Periodically posts Aegis D2A briefing highlights to Twitter/X using twitter-api-v2 directly.',
    services: [AegisTwitterService],
    init: async (_config: Record<string, string>) => {
        logger.info('*** Aegis Twitter Plugin Registered ***');
        logger.info(`*** Enabled: ${TWITTER_POST_CONFIG.ENABLED}, DryRun: ${TWITTER_POST_CONFIG.DRY_RUN} ***`);
    },
};

export default aegisTwitterPlugin;
