import type { Plugin } from '@elizaos/core';
import {
    type IAgentRuntime,
    Service,
    logger,
} from '@elizaos/core';
import { TwitterApi } from 'twitter-api-v2';
import {
    fetchAegisBriefing,
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
 */
function pickBestItem(briefing: AegisBriefingResponse): {
    title: string;
    topics: string[];
    score: number;
    sourceUrl?: string;
    content?: string;
} | null {
    if (isGlobalBriefing(briefing)) {
        const allItems: (AegisGlobalContributorItem & { _contributor?: string })[] = [];
        for (const c of briefing.contributors) {
            for (const item of c.topItems) {
                allItems.push(item);
            }
        }
        if (allItems.length === 0) return null;
        allItems.sort((a, b) => b.briefingScore - a.briefingScore);
        const best = allItems[0];
        return {
            title: best.title,
            topics: best.topics,
            score: best.briefingScore,
            sourceUrl: best.sourceUrl,
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
        try {
            logger.info('[AegisTwitter] Initializing Twitter API v2 client directly...');
            const client = new TwitterApi({
                appKey: apiKey,
                appSecret: apiSecretKey,
                accessToken: accessToken,
                accessSecret: accessTokenSecret,
            });

            // Test the connection by getting the authenticated user
            const me = await client.v2.me();
            logger.info(`[AegisTwitter] Twitter authenticated as @${me.data.username} (id: ${me.data.id})`);
            service.twitterClient = client;
        } catch (error: any) {
            service.initError = error.message;
            // Log the EXACT error — this is what we've been trying to see
            logger.error(`[AegisTwitter] TWITTER AUTH FAILED: ${error.message}`);
            if (error.code) {
                logger.error(`[AegisTwitter] Error code: ${error.code}`);
            }
            if (error.data) {
                try {
                    logger.error(`[AegisTwitter] Error data: ${JSON.stringify(error.data)}`);
                } catch { /* ignore */ }
            }
            // Don't throw — service starts but won't post
            logger.warn('[AegisTwitter] Service started without Twitter — will retry on each post cycle');
        }

        service.running = true;

        if (TWITTER_POST_CONFIG.POST_ON_STARTUP && service.twitterClient) {
            setTimeout(() => service.postBriefingTweet(runtime), 5_000);
        }

        service.scheduleNext(runtime);
        logger.info(
            `[AegisTwitter] Started — interval ${TWITTER_POST_CONFIG.INTERVAL_MIN}-${TWITTER_POST_CONFIG.INTERVAL_MAX} min` +
            `${TWITTER_POST_CONFIG.DRY_RUN ? ' (DRY RUN)' : ''}` +
            `${service.twitterClient ? '' : ' (NO TWITTER CLIENT)'}`
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
            if (error.code === 403 || error.code === 401) {
                // Auth error — reset client to retry next cycle
                this.twitterClient = null;
                this.initError = error.message;
                logger.warn('[AegisTwitter] Auth error — will retry client init next cycle');
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
