import { describe, test, expect, beforeEach, mock, afterAll } from 'bun:test';
import { _testExports, AegisTwitterService, aegisTwitterPlugin } from '../aegis-twitter-plugin.ts';
import type { AegisBriefingResponse, AegisGlobalBriefing, AegisIndividualBriefing } from '../aegis-briefing-plugin.ts';

const {
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
    TWITTER_POST_CONFIG,
    MIN_REPOST_GAP_MS,
    MAX_RECENT,
    getModuleState,
    resetModuleState,
} = _testExports;

// --- Fixture Helpers ---

function makeIndividualBriefing(items: Array<{
    title: string; score: number; topics?: string[];
    sourceUrl?: string; content?: string;
}>): AegisIndividualBriefing {
    return {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        summary: { totalEvaluated: items.length, totalBurned: 0, qualityRate: 1.0 },
        items: items.map(i => ({
            title: i.title,
            content: i.content || 'Test content',
            topics: i.topics || ['web3'],
            briefingScore: i.score,
            scores: { originality: 8, insight: 7, credibility: 9, composite: 8 },
            verdict: 'quality' as const,
            sourceUrl: i.sourceUrl,
        })),
    };
}

function makeGlobalBriefing(contributors: Array<{
    principal: string;
    items: Array<{ title: string; score: number; topics?: string[]; sourceUrl?: string }>;
}>): AegisGlobalBriefing {
    return {
        version: '1.0',
        type: 'global',
        generatedAt: new Date().toISOString(),
        pagination: { offset: 0, limit: 20, total: contributors.length },
        contributors: contributors.map(c => ({
            principal: c.principal,
            generatedAt: new Date().toISOString(),
            summary: { totalEvaluated: c.items.length, totalBurned: 0, qualityRate: 1.0 },
            topItems: c.items.map(i => ({
                title: i.title,
                topics: i.topics || ['defi'],
                briefingScore: i.score,
                verdict: 'quality' as const,
                sourceUrl: i.sourceUrl,
            })),
        })),
        aggregatedTopics: ['web3', 'defi'],
        totalEvaluated: contributors.reduce((sum, c) => sum + c.items.length, 0),
        totalQualityRate: 1.0,
    };
}

function makeMockRuntime(settings: Record<string, string> = {}, modelResult?: string) {
    return {
        getSetting: (key: string) => settings[key] || undefined,
        useModel: mock(async () => modelResult ?? 'Test commentary'),
    } as any;
}

// ==========================================
// cleanTitle
// ==========================================
describe('cleanTitle', () => {
    test('basic title passes through', () => {
        expect(cleanTitle('Hello World')).toBe('Hello World');
    });

    test('strips text after newline', () => {
        expect(cleanTitle('Title\nSkip to content Navigation')).toBe('Title');
    });

    test('removes "Skip to content" artifact', () => {
        expect(cleanTitle('Release v2.0 Skip to content')).toBe('Release v2.0');
    });

    test('removes "Navigation" artifact', () => {
        expect(cleanTitle('Some page Navigation menu items')).toBe('Some page');
    });

    test('removes "· GitHub" suffix', () => {
        expect(cleanTitle('Release v2.0.0-alpha.27 · GitHub')).toBe('Release v2.0.0-alpha.27');
    });

    test('removes "– GitHub" suffix (em dash)', () => {
        expect(cleanTitle('My Repo – GitHub')).toBe('My Repo');
    });

    test('collapses multiple spaces', () => {
        expect(cleanTitle('Hello    World   Test')).toBe('Hello World Test');
    });

    test('truncates title longer than 150 chars', () => {
        const longTitle = 'A'.repeat(200);
        const result = cleanTitle(longTitle);
        expect(result.length).toBe(150);
        expect(result.endsWith('...')).toBe(true);
    });

    test('handles exactly 150 chars without truncation', () => {
        const title = 'A'.repeat(150);
        expect(cleanTitle(title)).toBe(title);
    });

    test('handles exactly 151 chars with truncation', () => {
        const title = 'A'.repeat(151);
        const result = cleanTitle(title);
        expect(result.length).toBe(150);
        expect(result).toBe('A'.repeat(147) + '...');
    });

    test('returns fallback if cleaning produces empty string', () => {
        // "Skip to content" at start removes everything
        const result = cleanTitle('Skip to content\nSecond line');
        // After cleaning first line "Skip to content" → empty, fallback to raw first line
        expect(result.length).toBeGreaterThan(0);
    });

    test('handles empty string', () => {
        const result = cleanTitle('');
        expect(typeof result).toBe('string');
    });

    test('handles string with only whitespace', () => {
        const result = cleanTitle('   \n   ');
        expect(typeof result).toBe('string');
    });

    test('preserves Japanese characters', () => {
        expect(cleanTitle('ビットコイン最新ニュース')).toBe('ビットコイン最新ニュース');
    });

    test('handles mixed artifacts', () => {
        const messy = 'Release v2.0.0-alpha.27 · elizaOS/eliza\nSkip to content Nav...';
        const result = cleanTitle(messy);
        // Should strip "· elizaOS/eliza" part? No - only "· GitHub". So:
        expect(result).not.toContain('\n');
        expect(result).not.toContain('Skip to content');
    });
});

// ==========================================
// pickBestItem
// ==========================================
describe('pickBestItem', () => {
    beforeEach(() => {
        recentlyTweeted.clear();
    });

    test('returns highest-scored item from individual briefing', () => {
        const briefing = makeIndividualBriefing([
            { title: 'Low Score', score: 3 },
            { title: 'High Score', score: 9 },
            { title: 'Mid Score', score: 6 },
        ]);
        const result = pickBestItem(briefing);
        expect(result).not.toBeNull();
        expect(result!.title).toBe('High Score');
        expect(result!.score).toBe(9);
    });

    test('returns highest-scored item from global briefing', () => {
        const briefing = makeGlobalBriefing([
            { principal: 'p1', items: [{ title: 'P1 Item', score: 5 }] },
            { principal: 'p2', items: [{ title: 'P2 Item', score: 8 }] },
        ]);
        const result = pickBestItem(briefing);
        expect(result).not.toBeNull();
        expect(result!.title).toBe('P2 Item');
        expect(result!.contributorPrincipal).toBe('p2');
    });

    test('skips already-tweeted items', () => {
        const briefing = makeIndividualBriefing([
            { title: 'Already Tweeted', score: 10 },
            { title: 'Not Tweeted', score: 5 },
        ]);
        markAsTweeted('Already Tweeted');
        const result = pickBestItem(briefing);
        expect(result!.title).toBe('Not Tweeted');
    });

    test('returns null when all items tweeted', () => {
        const briefing = makeIndividualBriefing([
            { title: 'Item A', score: 8 },
            { title: 'Item B', score: 6 },
        ]);
        markAsTweeted('Item A');
        markAsTweeted('Item B');
        expect(pickBestItem(briefing)).toBeNull();
    });

    test('returns null for empty individual briefing', () => {
        const briefing = makeIndividualBriefing([]);
        expect(pickBestItem(briefing)).toBeNull();
    });

    test('returns null for empty global briefing', () => {
        const briefing = makeGlobalBriefing([]);
        expect(pickBestItem(briefing)).toBeNull();
    });

    test('returns null for global briefing with empty contributor items', () => {
        const briefing = makeGlobalBriefing([
            { principal: 'p1', items: [] },
        ]);
        expect(pickBestItem(briefing)).toBeNull();
    });

    test('includes sourceUrl from individual briefing', () => {
        const briefing = makeIndividualBriefing([
            { title: 'With URL', score: 8, sourceUrl: 'https://example.com' },
        ]);
        const result = pickBestItem(briefing);
        expect(result!.sourceUrl).toBe('https://example.com');
    });

    test('includes content from individual briefing', () => {
        const briefing = makeIndividualBriefing([
            { title: 'With Content', score: 8, content: 'Full article text here' },
        ]);
        const result = pickBestItem(briefing);
        expect(result!.content).toBe('Full article text here');
    });

    test('cleans titles during picking', () => {
        const briefing = makeIndividualBriefing([
            { title: 'Messy Title · GitHub\nSkip to content', score: 8 },
        ]);
        const result = pickBestItem(briefing);
        expect(result!.title).not.toContain('GitHub');
        expect(result!.title).not.toContain('\n');
    });

    test('handles global briefing with multiple contributors flattened and sorted', () => {
        const briefing = makeGlobalBriefing([
            { principal: 'p1', items: [
                { title: 'P1 Low', score: 2 },
                { title: 'P1 High', score: 9 },
            ]},
            { principal: 'p2', items: [
                { title: 'P2 Mid', score: 7 },
            ]},
        ]);
        // Should return P1 High (score 9) first
        const result = pickBestItem(briefing);
        expect(result!.title).toBe('P1 High');
        expect(result!.contributorPrincipal).toBe('p1');
    });

    test('falls through to lower-scored items across contributors', () => {
        const briefing = makeGlobalBriefing([
            { principal: 'p1', items: [{ title: 'Top', score: 10 }] },
            { principal: 'p2', items: [{ title: 'Second', score: 5 }] },
        ]);
        markAsTweeted('Top');
        const result = pickBestItem(briefing);
        expect(result!.title).toBe('Second');
    });
});

// ==========================================
// formatTweet
// ==========================================
describe('formatTweet', () => {
    test('basic tweet with all parts fits within 280 chars', () => {
        const item = {
            title: 'Bitcoin hits new high',
            topics: ['bitcoin', 'crypto'],
            score: 8,
            sourceUrl: 'https://example.com/article',
        };
        const tweet = formatTweet(item, 'Significant for market');
        expect(tweet.length).toBeLessThanOrEqual(280);
        expect(tweet).toContain('Bitcoin hits new high');
        expect(tweet).toContain('Significant for market');
        expect(tweet).toContain('#bitcoin');
        expect(tweet).toContain('https://example.com/article');
    });

    test('uses default aegis link when no sourceUrl', () => {
        const item = { title: 'Test', topics: ['web3'], score: 7 };
        const tweet = formatTweet(item);
        expect(tweet).toContain('https://aegis.dwebxr.xyz');
    });

    test('drops components progressively when too long', () => {
        const item = {
            title: 'A'.repeat(200),
            topics: ['longhashtag1', 'longhashtag2', 'longhashtag3'],
            score: 8,
            sourceUrl: 'https://example.com',
        };
        const longCommentary = 'B'.repeat(100);
        const tweet = formatTweet(item, longCommentary);
        expect(tweet.length).toBeLessThanOrEqual(280);
    });

    test('last resort: truncates title to fit', () => {
        const item = {
            title: 'X'.repeat(300),
            topics: [],
            score: 5,
            sourceUrl: 'https://example.com',
        };
        const tweet = formatTweet(item);
        expect(tweet.length).toBeLessThanOrEqual(280);
        expect(tweet).toContain('...');
        expect(tweet).toContain('https://example.com');
    });

    test('limits to 3 hashtags', () => {
        const item = {
            title: 'Test',
            topics: ['a', 'b', 'c', 'd', 'e'],
            score: 7,
        };
        const tweet = formatTweet(item);
        const hashtagCount = (tweet.match(/#/g) || []).length;
        expect(hashtagCount).toBeLessThanOrEqual(3);
    });

    test('sanitizes hashtag characters', () => {
        const item = {
            title: 'Test',
            topics: ['web 3.0', 'AI/ML', 'ブロックチェーン'],
            score: 7,
        };
        const tweet = formatTweet(item);
        expect(tweet).toContain('#web30');
        expect(tweet).toContain('#AIML');
        expect(tweet).toContain('#ブロックチェーン');
    });

    test('empty commentary is excluded', () => {
        const item = { title: 'Test', topics: ['web3'], score: 7 };
        const tweet = formatTweet(item, '');
        // Should not have double blank lines from empty commentary
        expect(tweet).not.toContain('\n\n\n');
    });

    test('empty topics produce no hashtags', () => {
        const item = { title: 'Test', topics: [], score: 7 };
        const tweet = formatTweet(item);
        expect(tweet).not.toContain('#');
    });

    test('tweet never exceeds MAX_TWEET_LENGTH', () => {
        // Stress test with maximum-length inputs
        const item = {
            title: 'タイトル'.repeat(50),
            topics: ['ロングトピック'.repeat(10), 'another'.repeat(20)],
            score: 9.5,
            sourceUrl: 'https://very-long-domain-name.example.com/path/to/article/with/many/segments',
        };
        const longCommentary = 'コメント'.repeat(30);
        const tweet = formatTweet(item, longCommentary);
        expect(tweet.length).toBeLessThanOrEqual(TWITTER_POST_CONFIG.MAX_TWEET_LENGTH);
    });
});

// ==========================================
// Deduplication: markAsTweeted / wasTweeted / expireOldTweets
// ==========================================
describe('deduplication', () => {
    beforeEach(() => {
        recentlyTweeted.clear();
    });

    test('markAsTweeted and wasTweeted basic flow', () => {
        expect(wasTweeted('Item A')).toBe(false);
        markAsTweeted('Item A');
        expect(wasTweeted('Item A')).toBe(true);
    });

    test('wasTweeted returns false after gap expires', () => {
        // Manually set an old timestamp using normalized key
        recentlyTweeted.set(normalizeForDedup('Old Item'), Date.now() - MIN_REPOST_GAP_MS - 1000);
        expect(wasTweeted('Old Item')).toBe(false);
        // Should also clean up the entry
        expect(recentlyTweeted.has(normalizeForDedup('Old Item'))).toBe(false);
    });

    test('wasTweeted returns true within gap', () => {
        recentlyTweeted.set(normalizeForDedup('Recent Item'), Date.now() - 1000);
        expect(wasTweeted('Recent Item')).toBe(true);
    });

    test('fuzzy dedup catches similar titles with different punctuation', () => {
        markAsTweeted('Hello World!');
        expect(wasTweeted('hello world')).toBe(true);
        expect(wasTweeted('Hello   World!')).toBe(true);
        expect(wasTweeted('HELLO WORLD')).toBe(true);
    });

    test('markAsTweeted caps size at MAX_RECENT', () => {
        for (let i = 0; i < MAX_RECENT + 10; i++) {
            markAsTweeted(`Item ${i}`);
        }
        expect(recentlyTweeted.size).toBe(MAX_RECENT);
    });

    test('markAsTweeted removes oldest when cap exceeded', () => {
        for (let i = 0; i < MAX_RECENT + 1; i++) {
            markAsTweeted(`Item ${i}`);
        }
        // Item 0 should have been evicted
        expect(recentlyTweeted.has(normalizeForDedup('Item 0'))).toBe(false);
        // Latest item should still be there
        expect(recentlyTweeted.has(normalizeForDedup(`Item ${MAX_RECENT}`))).toBe(true);
    });

    test('expireOldTweets removes old entries', () => {
        recentlyTweeted.set(normalizeForDedup('Old 1'), Date.now() - MIN_REPOST_GAP_MS - 1000);
        recentlyTweeted.set(normalizeForDedup('Old 2'), Date.now() - MIN_REPOST_GAP_MS - 2000);
        recentlyTweeted.set(normalizeForDedup('Recent'), Date.now());

        const cleared = expireOldTweets();
        expect(cleared).toBe(2);
        expect(recentlyTweeted.size).toBe(1);
        expect(recentlyTweeted.has(normalizeForDedup('Recent'))).toBe(true);
    });

    test('expireOldTweets returns 0 when nothing to expire', () => {
        markAsTweeted('Fresh');
        expect(expireOldTweets()).toBe(0);
    });

    test('expireOldTweets on empty map', () => {
        expect(expireOldTweets()).toBe(0);
    });
});

// ==========================================
// withTimeout
// ==========================================
describe('withTimeout', () => {
    test('resolves when promise completes before timeout', async () => {
        const result = await withTimeout(
            Promise.resolve('done'),
            1000,
            'test',
        );
        expect(result).toBe('done');
    });

    test('rejects when promise exceeds timeout', async () => {
        const slow = new Promise(resolve => setTimeout(resolve, 5000));
        try {
            await withTimeout(slow, 50, 'slow-op');
            throw new Error('should not reach here');
        } catch (e: any) {
            expect(e.message).toContain('slow-op timed out after 50ms');
        }
    });

    test('forwards promise rejection', async () => {
        try {
            await withTimeout(
                Promise.reject(new Error('inner error')),
                1000,
                'test',
            );
            throw new Error('should not reach here');
        } catch (e: any) {
            expect(e.message).toBe('inner error');
        }
    });

    test('clears timer on successful resolution (no leaked timers)', async () => {
        // If timer leaks, this test would hang or cause issues
        const result = await withTimeout(
            new Promise(resolve => setTimeout(() => resolve('ok'), 10)),
            5000,
            'test',
        );
        expect(result).toBe('ok');
    });

    test('handles zero timeout', async () => {
        try {
            await withTimeout(
                new Promise(resolve => setTimeout(resolve, 100)),
                0,
                'zero',
            );
            throw new Error('should not reach here');
        } catch (e: any) {
            expect(e.message).toContain('zero timed out');
        }
    });
});

// ==========================================
// generateCommentary
// ==========================================
describe('generateCommentary', () => {
    test('returns cleaned LLM output', async () => {
        const runtime = makeMockRuntime({}, 'This is a key development for DeFi');
        const result = await generateCommentary(runtime, {
            title: 'DeFi Protocol Launch',
            topics: ['defi'],
            score: 8,
        });
        expect(result).toBe('This is a key development for DeFi');
    });

    test('strips wrapping quotes from LLM output', async () => {
        const runtime = makeMockRuntime({}, '"Quoted commentary"');
        const result = await generateCommentary(runtime, {
            title: 'Test', topics: ['web3'], score: 7,
        });
        expect(result).toBe('Quoted commentary');
    });

    test('strips Japanese quotes', async () => {
        const runtime = makeMockRuntime({}, '「日本語コメント」');
        const result = await generateCommentary(runtime, {
            title: 'テスト', topics: ['web3'], score: 7,
        });
        expect(result).toBe('日本語コメント');
    });

    test('strips known prefixes (Commentary:, Analysis:, etc.)', async () => {
        const runtime = makeMockRuntime({}, 'Commentary: This is important');
        const result = await generateCommentary(runtime, {
            title: 'Test', topics: ['web3'], score: 7,
        });
        expect(result).toBe('This is important');
    });

    test('strips Japanese prefix (コメント：)', async () => {
        const runtime = makeMockRuntime({}, 'コメント：重要な進展です');
        const result = await generateCommentary(runtime, {
            title: 'テスト', topics: ['web3'], score: 7,
        });
        expect(result).toBe('重要な進展です');
    });

    test('truncates commentary over 100 chars', async () => {
        const longText = 'A'.repeat(120);
        const runtime = makeMockRuntime({}, longText);
        const result = await generateCommentary(runtime, {
            title: 'Test', topics: ['web3'], score: 7,
        });
        expect(result.length).toBe(100);
        expect(result.endsWith('...')).toBe(true);
    });

    test('returns empty string on LLM failure', async () => {
        const runtime = {
            getSetting: () => undefined,
            useModel: mock(async () => { throw new Error('LLM error'); }),
        } as any;
        const result = await generateCommentary(runtime, {
            title: 'Test', topics: ['web3'], score: 7,
        });
        expect(result).toBe('');
    });

    test('returns empty string for null LLM result', async () => {
        const runtime = {
            getSetting: () => undefined,
            useModel: mock(async () => null),
        } as any;
        const result = await generateCommentary(runtime, {
            title: 'Test', topics: ['web3'], score: 7,
        });
        expect(result).toBe('');
    });

    test('returns empty string for non-string LLM result', async () => {
        const runtime = {
            getSetting: () => undefined,
            useModel: mock(async () => 42),
        } as any;
        const result = await generateCommentary(runtime, {
            title: 'Test', topics: ['web3'], score: 7,
        });
        expect(result).toBe('');
    });

    test('uses content snippet in prompt when available', async () => {
        const runtime = makeMockRuntime({}, 'Good analysis');
        await generateCommentary(runtime, {
            title: 'Test',
            content: 'Long article content here',
            topics: ['web3'],
            score: 7,
        });
        // Verify useModel was called (the prompt construction is internal)
        expect(runtime.useModel).toHaveBeenCalledTimes(1);
    });
});

// ==========================================
// tryInitClient
// ==========================================
describe('tryInitClient', () => {
    beforeEach(() => {
        resetModuleState();
    });

    test('returns false when credentials are missing', () => {
        const runtime = makeMockRuntime({});
        const result = tryInitClient(runtime);
        expect(result).toBe(false);
        const state = getModuleState();
        expect(state.globalInitError).toContain('Missing');
    });

    test('returns false when only some credentials provided', () => {
        const runtime = makeMockRuntime({
            TWITTER_API_KEY: 'key',
            // Missing the others
        });
        const result = tryInitClient(runtime);
        expect(result).toBe(false);
        expect(getModuleState().globalInitError).toContain('TWITTER_API_SECRET_KEY');
    });

    test('returns true with all credentials', () => {
        const runtime = makeMockRuntime({
            TWITTER_API_KEY: 'key',
            TWITTER_API_SECRET_KEY: 'secret',
            TWITTER_ACCESS_TOKEN: 'token',
            TWITTER_ACCESS_TOKEN_SECRET: 'tokensecret',
        });
        const result = tryInitClient(runtime);
        expect(result).toBe(true);
        expect(getModuleState().globalTwitterClient).not.toBeNull();
        expect(getModuleState().globalInitError).toBeNull();
    });

    test('returns true without re-creating if client already exists', () => {
        const runtime = makeMockRuntime({
            TWITTER_API_KEY: 'key',
            TWITTER_API_SECRET_KEY: 'secret',
            TWITTER_ACCESS_TOKEN: 'token',
            TWITTER_ACCESS_TOKEN_SECRET: 'tokensecret',
        });
        tryInitClient(runtime);
        const client1 = getModuleState().globalTwitterClient;

        // Call again — should return same client
        tryInitClient(runtime);
        const client2 = getModuleState().globalTwitterClient;
        expect(client1).toBe(client2);
    });

    test('reports all missing keys in error', () => {
        const runtime = makeMockRuntime({});
        tryInitClient(runtime);
        const error = getModuleState().globalInitError!;
        expect(error).toContain('TWITTER_API_KEY');
        expect(error).toContain('TWITTER_API_SECRET_KEY');
        expect(error).toContain('TWITTER_ACCESS_TOKEN');
        expect(error).toContain('TWITTER_ACCESS_TOKEN_SECRET');
    });
});

// ==========================================
// AegisTwitterService lifecycle
// ==========================================
describe('AegisTwitterService', () => {
    beforeEach(() => {
        resetModuleState();
    });

    afterAll(() => {
        resetModuleState();
    });

    test('has correct serviceType', () => {
        expect(AegisTwitterService.serviceType).toBe('aegis-twitter');
    });

    test('stop() is a no-op (does not throw)', async () => {
        const runtime = makeMockRuntime({});
        const service = new AegisTwitterService(runtime);
        await expect(service.stop()).resolves.toBeUndefined();
    });

    test('static stop() is a no-op (does not throw)', async () => {
        const runtime = makeMockRuntime({});
        await expect(AegisTwitterService.stop(runtime)).resolves.toBeUndefined();
    });

    test('start() returns service when disabled', async () => {
        // Save and override
        const original = TWITTER_POST_CONFIG.ENABLED;
        (TWITTER_POST_CONFIG as any).ENABLED = false;
        try {
            const runtime = makeMockRuntime({});
            const service = await AegisTwitterService.start(runtime);
            expect(service).toBeInstanceOf(AegisTwitterService);
            expect(getModuleState().globalIntervalHandle).toBeNull();
        } finally {
            (TWITTER_POST_CONFIG as any).ENABLED = original;
        }
    });

    test('start() returns service without interval when credentials missing', async () => {
        const runtime = makeMockRuntime({});
        const service = await AegisTwitterService.start(runtime);
        expect(service).toBeInstanceOf(AegisTwitterService);
        expect(getModuleState().globalIntervalHandle).toBeNull();
    });

    test('start() creates interval when credentials provided', async () => {
        const runtime = makeMockRuntime({
            TWITTER_API_KEY: 'key',
            TWITTER_API_SECRET_KEY: 'secret',
            TWITTER_ACCESS_TOKEN: 'token',
            TWITTER_ACCESS_TOKEN_SECRET: 'tokensecret',
        });
        const service = await AegisTwitterService.start(runtime);
        expect(service).toBeInstanceOf(AegisTwitterService);
        expect(getModuleState().globalIntervalHandle).not.toBeNull();
        expect(getModuleState().globalRuntime).toBe(runtime);
        // Clean up
        resetModuleState();
    });

    test('start() clears previous interval on re-start', async () => {
        const runtime = makeMockRuntime({
            TWITTER_API_KEY: 'key',
            TWITTER_API_SECRET_KEY: 'secret',
            TWITTER_ACCESS_TOKEN: 'token',
            TWITTER_ACCESS_TOKEN_SECRET: 'tokensecret',
        });
        await AegisTwitterService.start(runtime);
        const handle1 = getModuleState().globalIntervalHandle;

        await AegisTwitterService.start(runtime);
        const handle2 = getModuleState().globalIntervalHandle;

        expect(handle1).not.toBe(handle2);
        resetModuleState();
    });
});

// ==========================================
// Plugin export structure
// ==========================================
describe('aegisTwitterPlugin', () => {
    test('has correct name', () => {
        expect(aegisTwitterPlugin.name).toBe('aegis-twitter');
    });

    test('has services array with AegisTwitterService', () => {
        expect(aegisTwitterPlugin.services).toContain(AegisTwitterService);
    });

    test('init does not throw', async () => {
        await expect(aegisTwitterPlugin.init!({} as any)).resolves.toBeUndefined();
    });
});

// ==========================================
// Concurrency: intervalTick overlap guard
// ==========================================
describe('intervalTick concurrency', () => {
    beforeEach(() => {
        resetModuleState();
    });

    test('skips when no runtime available', async () => {
        // globalRuntime is null after reset
        const { intervalTick } = _testExports;
        await intervalTick();
        // Should not throw, just skip
        expect(getModuleState().isPostingInProgress).toBe(false);
    });
});

// ==========================================
// Integration: pickBestItem + dedup exhaustion recovery
// ==========================================
describe('exhaustion recovery flow', () => {
    beforeEach(() => {
        recentlyTweeted.clear();
    });

    test('full exhaustion → expire → pick works', () => {
        const briefing = makeIndividualBriefing([
            { title: 'Item A', score: 8 },
            { title: 'Item B', score: 6 },
        ]);

        // Mark both as recently tweeted (within gap)
        markAsTweeted('Item A');
        markAsTweeted('Item B');

        // All exhausted
        expect(pickBestItem(briefing)).toBeNull();

        // Now manually age Item A past the gap (use normalized key)
        recentlyTweeted.set(normalizeForDedup('Item A'), Date.now() - MIN_REPOST_GAP_MS - 1000);

        // expireOldTweets clears it from the map
        const cleared = expireOldTweets();
        expect(cleared).toBe(1);

        // Now Item A is available again
        const result = pickBestItem(briefing);
        expect(result).not.toBeNull();
        expect(result!.title).toBe('Item A');
    });

    test('full exhaustion → clear all → pick top works', () => {
        const briefing = makeIndividualBriefing([
            { title: 'Best', score: 10 },
            { title: 'Second', score: 5 },
        ]);

        markAsTweeted('Best');
        markAsTweeted('Second');

        expect(pickBestItem(briefing)).toBeNull();
        expireOldTweets(); // Won't help since they're fresh
        expect(pickBestItem(briefing)).toBeNull();

        // Clear all
        recentlyTweeted.clear();
        const result = pickBestItem(briefing);
        expect(result!.title).toBe('Best');
    });
});
