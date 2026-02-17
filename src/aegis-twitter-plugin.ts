import type { Plugin } from '@elizaos/core';
import {
    type IAgentRuntime,
    Service,
    logger,
} from '@elizaos/core';
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

    const link = item.sourceUrl ? `\n${item.sourceUrl}` : '';

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
// Service: Aegis Twitter Poster
// ============================================
export class AegisTwitterService extends Service {
    static serviceType = 'aegis-twitter';
    capabilityDescription = 'Posts Aegis D2A briefing highlights to Twitter/X periodically';

    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;

    static async start(runtime: IAgentRuntime): Promise<AegisTwitterService> {
        const service = new AegisTwitterService(runtime);

        if (!TWITTER_POST_CONFIG.ENABLED) {
            logger.info('[AegisTwitter] Disabled via AEGIS_TWEET_ENABLED=false');
            return service;
        }

        // Check that Twitter credentials are available
        const hasTwitter = runtime.getSetting('TWITTER_API_KEY');
        if (!hasTwitter) {
            logger.warn('[AegisTwitter] TWITTER_API_KEY not set — service will not post');
            return service;
        }

        service.running = true;

        if (TWITTER_POST_CONFIG.POST_ON_STARTUP) {
            // Small delay to let Twitter service initialize
            setTimeout(() => service.postBriefingTweet(runtime), 30_000);
        }

        service.scheduleNext(runtime);
        logger.info(
            `[AegisTwitter] Started — interval ${TWITTER_POST_CONFIG.INTERVAL_MIN}-${TWITTER_POST_CONFIG.INTERVAL_MAX} min` +
            `${TWITTER_POST_CONFIG.DRY_RUN ? ' (DRY RUN)' : ''}`
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

    private async postBriefingTweet(runtime: IAgentRuntime): Promise<void> {
        try {
            logger.info('[AegisTwitter] Fetching briefing for tweet...');
            const briefing = await fetchAegisBriefing();

            const item = pickBestItem(briefing);
            if (!item) {
                logger.warn('[AegisTwitter] No items in briefing to tweet');
                return;
            }

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

            // Get the Twitter service from runtime
            const twitterService = runtime.getService('twitter') as any;
            if (!twitterService?.twitterClient?.client) {
                logger.warn('[AegisTwitter] Twitter service not available — skipping post');
                return;
            }

            const client = twitterService.twitterClient.client;
            const result = await client.twitterClient.sendTweet(tweet);

            const tweetData = result?.data?.data || result?.data;
            const tweetId = tweetData?.id;
            const username = client.profile?.username || 'unknown';

            markAsTweeted(item.title);

            if (tweetId) {
                logger.info(`[AegisTwitter] Posted: https://x.com/${username}/status/${tweetId}`);
            } else {
                logger.info(`[AegisTwitter] Tweet sent (${tweet.length} chars)`);
            }
        } catch (error: any) {
            logger.error(`[AegisTwitter] Failed to post: ${error.message}`);
        }
    }
}

// ============================================
// Plugin Export
// ============================================
export const aegisTwitterPlugin: Plugin = {
    name: 'aegis-twitter',
    description:
        'Periodically posts Aegis D2A briefing highlights to Twitter/X. ' +
        'Requires @elizaos/plugin-twitter to be configured with valid API credentials.',
    services: [AegisTwitterService],
    init: async (_config: Record<string, string>) => {
        logger.info('*** Aegis Twitter Plugin Registered ***');
        logger.info(`*** Enabled: ${TWITTER_POST_CONFIG.ENABLED} ***`);
        logger.info(`*** Interval: ${TWITTER_POST_CONFIG.INTERVAL_MIN}-${TWITTER_POST_CONFIG.INTERVAL_MAX} min ***`);
        logger.info(`*** Dry run: ${TWITTER_POST_CONFIG.DRY_RUN} ***`);
    },
};

export default aegisTwitterPlugin;
