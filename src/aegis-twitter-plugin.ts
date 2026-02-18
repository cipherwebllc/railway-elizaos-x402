import type { Plugin } from '@elizaos/core';
import {
    type IAgentRuntime,
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
 * Pick the best item to tweet about from a briefing.
 * For global briefings, also returns the contributor's principal
 * so we can fetch the individual briefing for the sourceUrl.
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
        const best = allItems[0];
        return {
            title: best.item.title,
            topics: best.item.topics,
            score: best.item.briefingScore,
            sourceUrl: (best.item as any).sourceUrl || undefined,
            contributorPrincipal: best.principal,
        };
    } else {
        if (!briefing.items || briefing.items.length === 0) return null;
        const sorted = [...briefing.items].sort(
            (a, b) => b.briefingScore - a.briefingScore
        );
        const best = sorted[0];
        return {
            title: best.title,
            topics: best.topics,
            score: best.briefingScore,
            sourceUrl: best.sourceUrl,
            content: best.content,
        };
    }
}

// Variety in tweet templates to avoid repetitive posts
const TWEET_TEMPLATES = [
    (title: string, hashtags: string, link: string) =>
        `${title}\n\nAegis D2A quality-scored briefing\n${hashtags}${link}`,
    (title: string, hashtags: string, link: string) =>
        `${title}\n\n${hashtags}${link}`,
    (title: string, hashtags: string, link: string) =>
        `Aegis D2A Briefing:\n${title}\n${hashtags}${link}`,
    (title: string, hashtags: string, link: string) =>
        `${title}\n\nFiltered by Aegis VCL scoring\n${hashtags}${link}`,
];

/**
 * Format an Aegis briefing item as a tweet.
 */
function formatTweet(item: {
    title: string;
    topics: string[];
    score: number;
    sourceUrl?: string;
    content?: string;
}): string {
    const maxLen = TWITTER_POST_CONFIG.MAX_TWEET_LENGTH;

    // Build hashtags from topics (up to 3)
    const hashtags = item.topics
        .slice(0, 3)
        .map(t => `#${t.replace(/[^a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '')}`)
        .join(' ');

    const link = item.sourceUrl
        ? `\n${item.sourceUrl}`
        : `\nhttps://aegis.dwebxr.xyz`;

    // Pick a random template
    const template = TWEET_TEMPLATES[Math.floor(Math.random() * TWEET_TEMPLATES.length)];

    // Try with full title first
    let tweet = template(item.title, hashtags, link);

    // If too long, truncate title
    if (tweet.length > maxLen) {
        const overhead = tweet.length - item.title.length;
        const availableForTitle = maxLen - overhead - 3; // 3 for "..."
        const truncatedTitle = item.title.slice(0, availableForTitle) + '...';
        tweet = template(truncatedTitle, hashtags, link);
    }

    // If still too long, drop hashtags
    if (tweet.length > maxLen) {
        tweet = template(item.title, '', link);
        if (tweet.length > maxLen) {
            const overhead = tweet.length - item.title.length;
            const availableForTitle = maxLen - overhead - 3;
            tweet = template(item.title.slice(0, availableForTitle) + '...', '', link);
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
            await this.postBriefingTweet(runtime);
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

            // If no sourceUrl and we have a contributor principal, fetch the individual briefing
            if (!item.sourceUrl && item.contributorPrincipal) {
                try {
                    const indBriefing = await fetchIndividualBriefing(item.contributorPrincipal);
                    if (indBriefing?.items) {
                        // Match by title (normalize whitespace for comparison)
                        const normalizeTitle = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
                        const matchedItem = indBriefing.items.find(
                            i => normalizeTitle(i.title) === normalizeTitle(item.title)
                        );
                        if (matchedItem?.sourceUrl) {
                            item.sourceUrl = matchedItem.sourceUrl;
                            logger.info(`[AegisTwitter] Found sourceUrl from individual briefing: ${matchedItem.sourceUrl}`);
                        } else {
                            logger.info(`[AegisTwitter] No matching sourceUrl in individual briefing (${indBriefing.items.length} items checked)`);
                        }
                    }
                } catch (error: any) {
                    logger.warn(`[AegisTwitter] Failed to fetch individual briefing for sourceUrl: ${error.message}`);
                }
            }

            logger.info(`[AegisTwitter] Best item: "${item.title.slice(0, 60)}..." score=${item.score} sourceUrl=${item.sourceUrl || 'none'}`);

            // Skip if we already tweeted this
            if (wasTweeted(item.title)) {
                logger.info(`[AegisTwitter] Skipping already tweeted: "${item.title.slice(0, 50)}..."`);
                return;
            }

            const tweet = formatTweet(item);

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
