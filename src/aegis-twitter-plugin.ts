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
    isGlobalBriefing,
    type AegisBriefingResponse,
} from './aegis-briefing-plugin.ts';

// Suppress AI SDK warnings that flood Railway logs
(globalThis as any).AI_SDK_LOG_WARNINGS = false;

// --- Configuration ---
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

/** Wrap a promise with a timeout. Rejects if not settled within `ms` ms. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

// --- Tweet Formatting ---

/** Clean scraped web content from a title (nav text, whitespace, etc.) */
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

interface TweetCandidate {
    title: string;
    topics: string[];
    score: number;
    sourceUrl?: string;
    content?: string;
    contributorPrincipal?: string;
}

/** Pick the highest-scored un-tweeted item. Returns null when all exhausted. */
function pickBestItem(briefing: AegisBriefingResponse): TweetCandidate | null {
    // Normalize both briefing types into a flat sorted list
    const candidates: TweetCandidate[] = [];

    if (isGlobalBriefing(briefing)) {
        for (const c of briefing.contributors) {
            for (const item of c.topItems) {
                candidates.push({
                    title: cleanTitle(item.title),
                    topics: item.topics,
                    score: item.briefingScore,
                    sourceUrl: item.sourceUrl,
                    contributorPrincipal: c.principal,
                });
            }
        }
    } else if (briefing.items) {
        for (const item of briefing.items) {
            candidates.push({
                title: cleanTitle(item.title),
                topics: item.topics,
                score: item.briefingScore,
                sourceUrl: item.sourceUrl,
                content: item.content,
            });
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);

    for (const c of candidates) {
        if (!wasTweeted(c.title)) return c;
    }
    logger.info(`[AegisTwitter] All ${candidates.length} items already tweeted`);
    return null;
}

// --- LLM Commentary ---

/** Generate a concise LLM commentary for a briefing item. Returns '' on failure. */
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

/** Format a briefing item as a tweet with optional LLM commentary. */
function formatTweet(item: TweetCandidate, commentary: string = ''): string {
    const maxLen = TWITTER_POST_CONFIG.MAX_TWEET_LENGTH;
    const link = `\n${item.sourceUrl || 'https://aegis.dwebxr.xyz'}`;
    const hashtags = item.topics
        .slice(0, 3)
        .map(t => `#${t.replace(/[^a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '')}`)
        .join(' ');

    const truncate = (s: string, max: number) =>
        s.length <= max ? s : s.slice(0, max - 3) + '...';

    const build = (parts: string[]) =>
        parts.filter(Boolean).join('\n\n') + link;

    // Try progressively simpler formats until it fits
    const attempts = [
        () => build([item.title, commentary, hashtags]),
        () => build([item.title, commentary]),
        () => build([item.title, hashtags]),
        () => build([item.title]),
    ];

    for (const attempt of attempts) {
        const tweet = attempt();
        if (tweet.length <= maxLen) return tweet;
    }

    // Last resort: truncate title to fit
    const available = maxLen - link.length;
    return truncate(item.title, available) + link;
}

// --- Recently-tweeted deduplication (normalized title → timestamp, 24h gap) ---
const MIN_REPOST_GAP_MS = 24 * 60 * 60 * 1000;
const recentlyTweeted = new Map<string, number>();
const MAX_RECENT = 200;

/** Normalize title for fuzzy dedup: lowercase, strip punctuation/whitespace */
function normalizeForDedup(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '')
        .trim();
}

function markAsTweeted(title: string): void {
    const key = normalizeForDedup(title);
    recentlyTweeted.set(key, Date.now());
    // Cap size by removing oldest entries
    if (recentlyTweeted.size > MAX_RECENT) {
        const oldest = recentlyTweeted.keys().next().value;
        if (oldest) recentlyTweeted.delete(oldest);
    }
}

function wasTweeted(title: string): boolean {
    const key = normalizeForDedup(title);
    const ts = recentlyTweeted.get(key);
    if (ts === undefined) return false;
    // Allow re-posting after the minimum gap
    if (Date.now() - ts > MIN_REPOST_GAP_MS) {
        recentlyTweeted.delete(key);
        return false;
    }
    return true;
}

/** Remove entries older than MIN_REPOST_GAP_MS. Returns count cleared. */
function expireOldTweets(): number {
    const now = Date.now();
    let cleared = 0;
    for (const [key, ts] of recentlyTweeted) {
        if (now - ts > MIN_REPOST_GAP_MS) {
            recentlyTweeted.delete(key);
            cleared++;
        }
    }
    return cleared;
}

// --- Module-level state (survives service lifecycle / stop() calls) ---
let globalIntervalHandle: ReturnType<typeof setInterval> | null = null;
let globalRuntime: IAgentRuntime | null = null;
let globalTwitterClient: TwitterApi | null = null;
let globalInitError: string | null = null;
let isPostingInProgress = false;
let cycleCount = 0;
let consecutive503Count = 0;
const MAX_503_RETRIES = 2;

const TWITTER_CRED_KEYS = [
    'TWITTER_API_KEY', 'TWITTER_API_SECRET_KEY',
    'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_TOKEN_SECRET',
] as const;

/** Try to (re-)initialize the Twitter client. Returns true if client is ready. */
function tryInitClient(runtime: IAgentRuntime): boolean {
    if (globalTwitterClient) return true;

    const creds = TWITTER_CRED_KEYS.map(k => runtime.getSetting(k));
    const missing = TWITTER_CRED_KEYS.filter((_, i) => !creds[i]);
    if (missing.length > 0) {
        globalInitError = `Missing: ${missing.join(', ')}`;
        return false;
    }

    try {
        globalTwitterClient = new TwitterApi({
            appKey: creds[0] as string,
            appSecret: creds[1] as string,
            accessToken: creds[2] as string,
            accessSecret: creds[3] as string,
        });
        globalInitError = null;
        logger.info('[AegisTwitter] Twitter client initialized');
        return true;
    } catch (error: any) {
        globalInitError = error.message;
        logger.warn(`[AegisTwitter] Twitter init failed: ${error.message}`);
        return false;
    }
}

/** Core tweet posting logic. Called by the interval timer. */
async function postBriefingTweet(runtime: IAgentRuntime): Promise<void> {
    let currentItemTitle: string | null = null;
    try {
        cycleCount++;
        logger.info(`[AegisTwitter] Cycle #${cycleCount} | tracked=${recentlyTweeted.size} | client=${globalTwitterClient ? 'ready' : 'null'}`);

        const briefing = await withTimeout(fetchAegisBriefing(), 30_000, 'Aegis briefing fetch');

        // Try picking an item; on exhaustion, expire old entries only (never clear all)
        let item = pickBestItem(briefing);
        if (!item) {
            const cleared = expireOldTweets();
            logger.info(`[AegisTwitter] All items tweeted. Expired ${cleared} old entries, retrying...`);
            item = pickBestItem(briefing);
        }
        if (!item) {
            logger.info(`[AegisTwitter] All ${recentlyTweeted.size} items still in dedup window — skipping this cycle to avoid duplicates`);
            return;
        }
        currentItemTitle = item.title;

        // Enrich items with sourceUrl/content from individual briefing
        // Global items need enrichment because topItems often lack sourceUrl;
        // individual items may also lack sourceUrl if the API omits it.
        if (!item.sourceUrl) {
            const principal = item.contributorPrincipal || process.env.AEGIS_IC_PRINCIPAL;
            if (principal) {
                try {
                    const indBriefing = await withTimeout(
                        fetchIndividualBriefing(principal), 30_000, 'Individual briefing fetch',
                    );
                    // Compare cleaned titles since pickBestItem already cleaned ours
                    const normalize = (t: string) => cleanTitle(t).replace(/\s+/g, ' ').trim().toLowerCase();
                    const normalizedItemTitle = normalize(item!.title);
                    const match = indBriefing?.items?.find(i => normalize(i.title) === normalizedItemTitle);
                    if (match) {
                        if (match.sourceUrl) item.sourceUrl = match.sourceUrl;
                        if (match.content && !item.content) item.content = match.content;
                        logger.info(`[AegisTwitter] Enriched item with sourceUrl: ${match.sourceUrl || 'none'}`);
                    } else {
                        logger.warn(`[AegisTwitter] No matching item in individual briefing for: "${item.title.slice(0, 50)}"`);
                    }
                } catch (error: any) {
                    logger.warn(`[AegisTwitter] Individual briefing fetch failed: ${error.message}`);
                }
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

        // Post tweet (with timeout to avoid indefinite hangs)
        const result = await withTimeout(
            globalTwitterClient!.v2.tweet({ text: tweet }),
            60_000,
            'Twitter API tweet',
        );
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
            } catch (serializeErr: any) {
                logger.warn(`[AegisTwitter] Could not serialize API error data: ${serializeErr.message}`);
            }
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

/** Interval callback. Guards against overlapping executions. */
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

        globalRuntime = runtime;
        if (!tryInitClient(runtime)) {
            logger.warn(`[AegisTwitter] ${globalInitError} — will not post`);
            return service;
        }

        // Clear any previous interval (in case start() is called multiple times)
        if (globalIntervalHandle) {
            clearInterval(globalIntervalHandle);
            globalIntervalHandle = null;
        }

        // Use a fixed interval. Average of min/max, converted to ms.
        const intervalMs = ((TWITTER_POST_CONFIG.INTERVAL_MIN + TWITTER_POST_CONFIG.INTERVAL_MAX) / 2) * 60 * 1000;

        if (TWITTER_POST_CONFIG.POST_ON_STARTUP) {
            // Post immediately (with small delay for other services to init)
            setTimeout(() => {
                intervalTick().catch((e) => {
                    logger.error(`[AegisTwitter] Startup tick error: ${e.message}`);
                });
            }, 10_000);
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

    // Intentionally no-op: interval is module-level and must survive lifecycle events
    static async stop(_runtime: IAgentRuntime): Promise<void> {}
    async stop(): Promise<void> {}
}

// --- Plugin Export ---
export const aegisTwitterPlugin: Plugin = {
    name: 'aegis-twitter',
    description: 'Periodically posts Aegis D2A briefing highlights to Twitter/X.',
    services: [AegisTwitterService],
    init: async () => {
        logger.info(`[AegisTwitter] Plugin registered (enabled=${TWITTER_POST_CONFIG.ENABLED}, dryRun=${TWITTER_POST_CONFIG.DRY_RUN})`);
    },
};

export default aegisTwitterPlugin;

// --- Test-only exports (used by test suite to exercise real code paths) ---
export const _testExports = {
    cleanTitle,
    pickBestItem,
    formatTweet,
    markAsTweeted,
    wasTweeted,
    expireOldTweets,
    normalizeForDedup,
    recentlyTweeted,
    withTimeout,
    generateCommentary,
    tryInitClient,
    postBriefingTweet,
    intervalTick,
    TWITTER_POST_CONFIG,
    MIN_REPOST_GAP_MS,
    MAX_RECENT,
    getModuleState: () => ({
        globalIntervalHandle,
        globalRuntime,
        globalTwitterClient,
        globalInitError,
        isPostingInProgress,
        cycleCount,
        consecutive503Count,
    }),
    resetModuleState: () => {
        if (globalIntervalHandle) clearInterval(globalIntervalHandle);
        globalIntervalHandle = null;
        globalRuntime = null;
        globalTwitterClient = null;
        globalInitError = null;
        isPostingInProgress = false;
        cycleCount = 0;
        consecutive503Count = 0;
        recentlyTweeted.clear();
    },
};
