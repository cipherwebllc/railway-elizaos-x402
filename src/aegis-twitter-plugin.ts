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
// Tweet Formatting
// ============================================

function isGlobalBriefing(data: AegisBriefingResponse): data is AegisGlobalBriefing {
    return 'type' in data && (data as any).type === 'global';
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
            if (!wasTweeted(entry.item.title)) {
                return {
                    title: entry.item.title,
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
            if (!wasTweeted(item.title)) {
                return {
                    title: item.title,
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

        const result = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
            maxTokens: 80,
            temperature: 0.7,
        });

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
// ============================================
const recentlyTweeted = new Set<string>();
const MAX_RECENT = 50;

function markAsTweeted(title: string): void {
    recentlyTweeted.add(title);
    if (recentlyTweeted.size > MAX_RECENT) {
        const oldest = recentlyTweeted.values().next().value;
        if (oldest) recentlyTweeted.delete(oldest);
    }
}

function wasTweeted(title: string): boolean {
    return recentlyTweeted.has(title);
}

// ============================================
// Service: Aegis Twitter Poster (Direct twitter-api-v2)
// ============================================
export class AegisTwitterService extends Service {
    static serviceType = 'aegis-twitter';
    capabilityDescription = 'Posts Aegis D2A briefing highlights to Twitter/X periodically';

    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private twitterClient: TwitterApi | null = null;
    private initError: string | null = null;

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
            logger.warn(`[AegisTwitter] Missing credentials: ${missing.join(', ')} — service will not post`);
            return service;
        }

        // Initialize twitter-api-v2 directly (bypass @elizaos/plugin-twitter)
        // Skip v2.me() validation — it consumes rate limit on every deploy.
        // Credentials will be validated on the first tweet attempt.
        logger.info('[AegisTwitter] Creating Twitter API v2 client...');
        service.twitterClient = new TwitterApi({
            appKey: apiKey,
            appSecret: apiSecretKey,
            accessToken: accessToken,
            accessSecret: accessTokenSecret,
        });
        logger.info('[AegisTwitter] Twitter client created (credentials will be validated on first post)');

        service.running = true;

        if (TWITTER_POST_CONFIG.POST_ON_STARTUP) {
            setTimeout(() => service.postBriefingTweet(runtime), 5_000);
        }

        service.scheduleNext(runtime);
        logger.info(
            `[AegisTwitter] Started — interval ${TWITTER_POST_CONFIG.INTERVAL_MIN}-${TWITTER_POST_CONFIG.INTERVAL_MAX} min` +
            `${TWITTER_POST_CONFIG.DRY_RUN ? ' (DRY RUN)' : ''}` +
            ` — client ready`
        );

        return service;
    }

    static async stop(_runtime: IAgentRuntime): Promise<void> {
        // Instance cleanup handled by instance stop()
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('[AegisTwitter] Stopped');
    }

    private getRandomInterval(): number {
        const min = TWITTER_POST_CONFIG.INTERVAL_MIN * 60 * 1000;
        const max = TWITTER_POST_CONFIG.INTERVAL_MAX * 60 * 1000;
        return min + Math.random() * (max - min);
    }

    private scheduleNext(runtime: IAgentRuntime): void {
        if (!this.running) return;
        const interval = this.getRandomInterval();
        logger.info(`[AegisTwitter] Next post in ${(interval / 60000).toFixed(0)} minutes`);
        this.timer = setTimeout(async () => {
            try {
                await this.postBriefingTweet(runtime);
            } catch (error: any) {
                // Catch-all so the timer chain never breaks
                logger.error(`[AegisTwitter] Unhandled error in postBriefingTweet: ${error.message}`);
            }
            this.scheduleNext(runtime);
        }, interval);
    }

    /**
     * Try to (re-)initialize the Twitter client if it's not available.
     */
    private async tryInitClient(runtime: IAgentRuntime): Promise<boolean> {
        if (this.twitterClient) return true;

        const apiKey = runtime.getSetting('TWITTER_API_KEY');
        const apiSecretKey = runtime.getSetting('TWITTER_API_SECRET_KEY');
        const accessToken = runtime.getSetting('TWITTER_ACCESS_TOKEN');
        const accessTokenSecret = runtime.getSetting('TWITTER_ACCESS_TOKEN_SECRET');

        if (!apiKey || !apiSecretKey || !accessToken || !accessTokenSecret) {
            return false;
        }

        try {
            const client = new TwitterApi({
                appKey: apiKey,
                appSecret: apiSecretKey,
                accessToken: accessToken,
                accessSecret: accessTokenSecret,
            });
            // Quick validation - don't call me() each time, just try to post
            this.twitterClient = client;
            this.initError = null;
            logger.info('[AegisTwitter] Twitter client re-initialized successfully');
            return true;
        } catch (error: any) {
            this.initError = error.message;
            logger.warn(`[AegisTwitter] Twitter re-init failed: ${error.message}`);
            return false;
        }
    }

    private async postBriefingTweet(runtime: IAgentRuntime): Promise<void> {
        try {
            logger.info('[AegisTwitter] Fetching briefing for tweet...');
            const briefing = await fetchAegisBriefing();

            const item = pickBestItem(briefing);
            if (!item) {
                logger.warn('[AegisTwitter] No items in briefing to tweet');
                return;
            }

            // If we have a contributor principal, fetch the individual briefing
            // for sourceUrl and content (used for LLM commentary)
            if (item.contributorPrincipal) {
                try {
                    const indBriefing = await fetchIndividualBriefing(item.contributorPrincipal);
                    if (indBriefing?.items) {
                        // Match by title (normalize whitespace for comparison)
                        const normalizeTitle = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
                        const matchedItem = indBriefing.items.find(
                            i => normalizeTitle(i.title) === normalizeTitle(item.title)
                        );
                        if (matchedItem) {
                            if (matchedItem.sourceUrl && !item.sourceUrl) {
                                item.sourceUrl = matchedItem.sourceUrl;
                                logger.info(`[AegisTwitter] Found sourceUrl from individual briefing: ${matchedItem.sourceUrl}`);
                            }
                            if (matchedItem.content && !item.content) {
                                item.content = matchedItem.content;
                                logger.info(`[AegisTwitter] Found content from individual briefing (${matchedItem.content.length} chars)`);
                            }
                        } else {
                            logger.info(`[AegisTwitter] No matching item in individual briefing (${indBriefing.items.length} items checked)`);
                        }
                    }
                } catch (error: any) {
                    logger.warn(`[AegisTwitter] Failed to fetch individual briefing: ${error.message}`);
                }
            }

            logger.info(`[AegisTwitter] Best item: "${item.title.slice(0, 60)}..." score=${item.score} sourceUrl=${item.sourceUrl || 'none'} content=${item.content ? item.content.length + ' chars' : 'none'}`);

            // Generate LLM commentary for the briefing item
            const commentary = await generateCommentary(runtime, item);

            const tweet = formatTweet(item, commentary);

            if (TWITTER_POST_CONFIG.DRY_RUN) {
                logger.info(`[AegisTwitter] DRY RUN would post (${tweet.length} chars):\n${tweet}`);
                markAsTweeted(item.title);
                return;
            }

            // Try to get/re-init the Twitter client
            if (!this.twitterClient) {
                const ok = await this.tryInitClient(runtime);
                if (!ok) {
                    logger.warn(`[AegisTwitter] No Twitter client available — last error: ${this.initError || 'unknown'}`);
                    return;
                }
            }

            // Post tweet using twitter-api-v2 directly
            const result = await this.twitterClient!.v2.tweet(tweet);
            markAsTweeted(item.title);

            const tweetId = result.data?.id;
            if (tweetId) {
                logger.info(`[AegisTwitter] Posted tweet id=${tweetId} (${tweet.length} chars)`);
            } else {
                logger.info(`[AegisTwitter] Tweet sent (${tweet.length} chars)`);
            }
        } catch (error: any) {
            logger.error(`[AegisTwitter] Failed to post: ${error.message}`);
            // Log response details for API errors
            if (error.data) {
                try {
                    logger.error(`[AegisTwitter] API response: ${JSON.stringify(error.data)}`);
                } catch { /* ignore */ }
            }
            if (error.code === 403) {
                logger.error('[AegisTwitter] 403 Forbidden — App likely has "Read" permissions only. Go to Developer Portal → App Settings → User authentication settings → change to "Read and Write", then regenerate Access Token & Secret.');
                // Don't reset client — the credentials are valid, just need Write permission
            } else if (error.code === 401) {
                this.twitterClient = null;
                this.initError = error.message;
                logger.warn('[AegisTwitter] 401 Unauthorized — will retry client init next cycle');
            }
        }
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
