import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
    isGlobalBriefing,
    formatBriefingForChat,
    aegisBriefingPlugin,
    _testExports,
    type AegisIndividualBriefing,
    type AegisGlobalBriefing,
    type AegisBriefingItem,
    type AegisBriefingResponse,
} from '../aegis-briefing-plugin.ts';

const {
    getCachedBriefing,
    setCachedBriefing,
    formatIndividualBriefing,
    formatGlobalBriefing,
    AEGIS_CONFIG,
    resetCache,
} = _testExports;

// --- Fixture Helpers ---

function makeItem(overrides: Partial<AegisBriefingItem> = {}): AegisBriefingItem {
    return {
        title: 'Test Article Title',
        content: 'Test article content about web3 developments.',
        topics: ['web3', 'defi'],
        briefingScore: 8.5,
        scores: { originality: 8, insight: 7, credibility: 9, composite: 8 },
        verdict: 'quality',
        ...overrides,
    };
}

function makeIndividualBriefing(overrides: Partial<AegisIndividualBriefing> = {}): AegisIndividualBriefing {
    return {
        version: '1.0',
        generatedAt: '2026-03-13T10:00:00Z',
        summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
        items: [
            makeItem({ title: 'Top Article', briefingScore: 9.2 }),
            makeItem({ title: 'Second Article', briefingScore: 7.5 }),
            makeItem({ title: 'Third Article', briefingScore: 6.0 }),
        ],
        ...overrides,
    };
}

function makeGlobalBriefing(overrides: Partial<AegisGlobalBriefing> = {}): AegisGlobalBriefing {
    return {
        version: '1.0',
        type: 'global',
        generatedAt: '2026-03-13T10:00:00Z',
        pagination: { offset: 0, limit: 20, total: 3 },
        contributors: [
            {
                principal: 'principal-1',
                generatedAt: '2026-03-13T10:00:00Z',
                summary: { totalEvaluated: 5, totalBurned: 1, qualityRate: 0.8 },
                topItems: [
                    { title: 'Global Item A', topics: ['bitcoin'], briefingScore: 9.0, verdict: 'quality' },
                    { title: 'Global Item B', topics: ['ethereum'], briefingScore: 7.0, verdict: 'quality' },
                ],
            },
            {
                principal: 'principal-2',
                generatedAt: '2026-03-13T10:00:00Z',
                summary: { totalEvaluated: 3, totalBurned: 0, qualityRate: 1.0 },
                topItems: [
                    { title: 'Global Item C', topics: ['defi', 'yield'], briefingScore: 8.5, verdict: 'quality', sourceUrl: 'https://example.com/c' },
                ],
            },
        ],
        aggregatedTopics: ['bitcoin', 'ethereum', 'defi', 'yield', 'web3'],
        totalEvaluated: 8,
        totalQualityRate: 0.875,
        ...overrides,
    };
}

// ==========================================
// isGlobalBriefing type guard
// ==========================================
describe('isGlobalBriefing', () => {
    test('returns true for global briefing', () => {
        const global = makeGlobalBriefing();
        expect(isGlobalBriefing(global)).toBe(true);
    });

    test('returns false for individual briefing', () => {
        const individual = makeIndividualBriefing();
        expect(isGlobalBriefing(individual)).toBe(false);
    });

    test('returns false for object with type !== "global"', () => {
        const data = { ...makeIndividualBriefing(), type: 'individual' } as any;
        expect(isGlobalBriefing(data)).toBe(false);
    });

    test('returns false for object without type field', () => {
        const data = { version: '1.0', items: [] } as any;
        expect(isGlobalBriefing(data)).toBe(false);
    });
});

// ==========================================
// Cache: getCachedBriefing / setCachedBriefing
// ==========================================
describe('cache', () => {
    beforeEach(() => {
        resetCache();
    });

    test('returns null when cache is empty', () => {
        expect(getCachedBriefing()).toBeNull();
    });

    test('returns cached data within TTL', () => {
        const briefing = makeIndividualBriefing();
        setCachedBriefing(briefing);
        const cached = getCachedBriefing();
        expect(cached).not.toBeNull();
        expect((cached as AegisIndividualBriefing).items.length).toBe(3);
    });

    test('returns null after TTL expires', () => {
        const briefing = makeIndividualBriefing();
        setCachedBriefing(briefing);

        // Set TTL to -1 so any cached entry is considered expired
        const originalTTL = AEGIS_CONFIG.CACHE_TTL;
        (AEGIS_CONFIG as any).CACHE_TTL = -1;
        expect(getCachedBriefing()).toBeNull();
        (AEGIS_CONFIG as any).CACHE_TTL = originalTTL;
    });

    test('overwrites previous cache entry', () => {
        setCachedBriefing(makeIndividualBriefing({ version: '1.0' }));
        setCachedBriefing(makeIndividualBriefing({ version: '2.0' }));
        const cached = getCachedBriefing() as AegisIndividualBriefing;
        expect(cached.version).toBe('2.0');
    });

    test('caches global briefing correctly', () => {
        const global = makeGlobalBriefing();
        setCachedBriefing(global);
        const cached = getCachedBriefing();
        expect(cached).not.toBeNull();
        expect(isGlobalBriefing(cached!)).toBe(true);
    });
});

// ==========================================
// formatIndividualBriefing
// ==========================================
describe('formatIndividualBriefing', () => {
    test('includes header with stats', () => {
        const briefing = makeIndividualBriefing();
        const result = formatIndividualBriefing(briefing, 5);
        expect(result).toContain('**Aegis D2A Briefing**');
        expect(result).toContain('評価数: 10件');
        expect(result).toContain('品質率: 80.0%');
        expect(result).toContain('除外: 2件');
    });

    test('sorts items by briefingScore descending', () => {
        const briefing = makeIndividualBriefing();
        const result = formatIndividualBriefing(briefing, 5);
        const topIdx = result.indexOf('Top Article');
        const secondIdx = result.indexOf('Second Article');
        expect(topIdx).toBeLessThan(secondIdx);
    });

    test('respects limit parameter', () => {
        const briefing = makeIndividualBriefing();
        const result = formatIndividualBriefing(briefing, 1);
        expect(result).toContain('Top Article');
        expect(result).not.toContain('Second Article');
        expect(result).not.toContain('Third Article');
    });

    test('includes score breakdown', () => {
        const briefing = makeIndividualBriefing();
        const result = formatIndividualBriefing(briefing, 1);
        expect(result).toContain('独自性:8');
        expect(result).toContain('洞察:7');
        expect(result).toContain('信頼性:9');
    });

    test('truncates long content to 280 chars', () => {
        const longContent = 'A'.repeat(500);
        const briefing = makeIndividualBriefing({
            items: [makeItem({ content: longContent })],
        });
        const result = formatIndividualBriefing(briefing, 1);
        expect(result).toContain('A'.repeat(280) + '...');
        expect(result).not.toContain('A'.repeat(281));
    });

    test('includes sourceUrl link when present', () => {
        const briefing = makeIndividualBriefing({
            items: [makeItem({ sourceUrl: 'https://example.com/article' })],
        });
        const result = formatIndividualBriefing(briefing, 1);
        expect(result).toContain('[続きを読む](https://example.com/article)');
    });

    test('omits sourceUrl link when absent', () => {
        const briefing = makeIndividualBriefing({
            items: [makeItem({ sourceUrl: undefined })],
        });
        const result = formatIndividualBriefing(briefing, 1);
        expect(result).not.toContain('続きを読む');
    });

    test('includes serendipity pick when present', () => {
        const briefing = makeIndividualBriefing({
            serendipityPick: makeItem({ title: 'Lucky Find' }),
        });
        const result = formatIndividualBriefing(briefing, 5);
        expect(result).toContain('セレンディピティ枠: Lucky Find');
    });

    test('omits serendipity section when null', () => {
        const briefing = makeIndividualBriefing({ serendipityPick: null });
        const result = formatIndividualBriefing(briefing, 5);
        expect(result).not.toContain('セレンディピティ');
    });

    test('includes scoring model when in meta', () => {
        const briefing = makeIndividualBriefing({
            meta: { scoringModel: 'gpt-4o-2026' },
        });
        const result = formatIndividualBriefing(briefing, 5);
        expect(result).toContain('_Scoring: gpt-4o-2026_');
    });

    test('handles empty items array', () => {
        const briefing = makeIndividualBriefing({ items: [] });
        const result = formatIndividualBriefing(briefing, 5);
        expect(result).toContain('**Aegis D2A Briefing**');
        // Should just have header, no items
    });
});

// ==========================================
// formatGlobalBriefing
// ==========================================
describe('formatGlobalBriefing', () => {
    test('includes header with global stats', () => {
        const briefing = makeGlobalBriefing();
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).toContain('**Aegis D2A グローバルブリーフィング**');
        expect(result).toContain('参加者: 3人');
        expect(result).toContain('総評価数: 8件');
        expect(result).toContain('品質率: 87.5%');
    });

    test('includes aggregated topics', () => {
        const briefing = makeGlobalBriefing();
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).toContain('注目トピック:');
        expect(result).toContain('bitcoin');
        expect(result).toContain('ethereum');
    });

    test('sorts items across contributors by score', () => {
        const briefing = makeGlobalBriefing();
        const result = formatGlobalBriefing(briefing, 5);
        // Global Item A (9.0) should come before Global Item C (8.5)
        const idxA = result.indexOf('Global Item A');
        const idxC = result.indexOf('Global Item C');
        expect(idxA).toBeLessThan(idxC);
    });

    test('respects item limit', () => {
        const briefing = makeGlobalBriefing();
        const result = formatGlobalBriefing(briefing, 1);
        expect(result).toContain('Global Item A'); // highest score
        expect(result).not.toContain('Global Item B');
    });

    test('includes sourceUrl when present', () => {
        const briefing = makeGlobalBriefing();
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).toContain('[続きを読む](https://example.com/c)');
    });

    test('shows verdict label (高品質)', () => {
        const briefing = makeGlobalBriefing();
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).toContain('判定: 高品質');
    });

    test('shows pagination hint when more data available', () => {
        const briefing = makeGlobalBriefing({
            pagination: { offset: 0, limit: 2, total: 10 },
        });
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).toContain('さらに 8 人の参加者のデータがあります');
    });

    test('no pagination hint when all data shown', () => {
        const briefing = makeGlobalBriefing({
            pagination: { offset: 0, limit: 20, total: 3 },
        });
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).not.toContain('さらに');
    });

    test('handles empty aggregatedTopics', () => {
        const briefing = makeGlobalBriefing({ aggregatedTopics: [] });
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).not.toContain('注目トピック:');
    });

    test('handles empty contributors', () => {
        const briefing = makeGlobalBriefing({ contributors: [] });
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).toContain('**Aegis D2A グローバルブリーフィング**');
    });

    test('limits aggregated topics to 8', () => {
        const briefing = makeGlobalBriefing({
            aggregatedTopics: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'],
        });
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).not.toContain('t9');
        expect(result).not.toContain('t10');
    });

    test('shows slop verdict correctly', () => {
        const briefing = makeGlobalBriefing({
            contributors: [{
                principal: 'p1',
                generatedAt: '2026-03-13T10:00:00Z',
                summary: { totalEvaluated: 1, totalBurned: 0, qualityRate: 0.5 },
                topItems: [
                    { title: 'Slop Item', topics: ['spam'], briefingScore: 2.0, verdict: 'slop' },
                ],
            }],
        });
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).toContain('判定: slop');
    });
});

// ==========================================
// formatBriefingForChat (routing)
// ==========================================
describe('formatBriefingForChat', () => {
    test('routes global briefing to formatGlobalBriefing', () => {
        const briefing = makeGlobalBriefing();
        const result = formatBriefingForChat(briefing);
        expect(result).toContain('グローバルブリーフィング');
    });

    test('routes individual briefing to formatIndividualBriefing', () => {
        const briefing = makeIndividualBriefing();
        const result = formatBriefingForChat(briefing);
        expect(result).toContain('Aegis D2A Briefing');
        expect(result).not.toContain('グローバル');
    });

    test('uses default limit from config', () => {
        const items = Array.from({ length: 10 }, (_, i) =>
            makeItem({ title: `Item ${i}`, briefingScore: 10 - i })
        );
        const briefing = makeIndividualBriefing({ items });
        const result = formatBriefingForChat(briefing);
        // Default CHAT_ITEM_LIMIT is 5
        const itemMatches = result.match(/\*\*\[\d+\]/g) || [];
        expect(itemMatches.length).toBeLessThanOrEqual(AEGIS_CONFIG.CHAT_ITEM_LIMIT);
    });

    test('respects custom limit', () => {
        const items = Array.from({ length: 10 }, (_, i) =>
            makeItem({ title: `Item ${i}`, briefingScore: 10 - i })
        );
        const briefing = makeIndividualBriefing({ items });
        const result = formatBriefingForChat(briefing, 2);
        const itemMatches = result.match(/\*\*\[\d+\]/g) || [];
        expect(itemMatches.length).toBe(2);
    });
});

// ==========================================
// Action validation
// ==========================================
describe('aegisBriefingAction validate', () => {
    const action = aegisBriefingPlugin.actions![0];
    const runtime = {} as any;
    const state = {} as any;

    function makeMessage(text: string) {
        return { content: { text } } as any;
    }

    test('matches "aegis" trigger', async () => {
        expect(await action.validate(runtime, makeMessage('Tell me about aegis'), state)).toBe(true);
    });

    test('matches Japanese trigger "ブリーフィング"', async () => {
        expect(await action.validate(runtime, makeMessage('最新のブリーフィングを見せて'), state)).toBe(true);
    });

    test('matches "briefing" trigger', async () => {
        expect(await action.validate(runtime, makeMessage('Show me the briefing'), state)).toBe(true);
    });

    test('matches "latest news" trigger', async () => {
        expect(await action.validate(runtime, makeMessage('What is the latest news?'), state)).toBe(true);
    });

    test('matches "trends" trigger', async () => {
        expect(await action.validate(runtime, makeMessage('What are the current trends?'), state)).toBe(true);
    });

    test('matches "d2a" trigger', async () => {
        expect(await action.validate(runtime, makeMessage('Show me d2a data'), state)).toBe(true);
    });

    test('matches "research" trigger', async () => {
        expect(await action.validate(runtime, makeMessage('Do some research on this'), state)).toBe(true);
    });

    test('matches "何が起きて" trigger', async () => {
        expect(await action.validate(runtime, makeMessage('今何が起きているの？'), state)).toBe(true);
    });

    test('does NOT match unrelated input', async () => {
        expect(await action.validate(runtime, makeMessage('Hello, how are you?'), state)).toBe(false);
    });

    test('does NOT match empty input', async () => {
        expect(await action.validate(runtime, makeMessage(''), state)).toBe(false);
    });

    test('is case insensitive', async () => {
        expect(await action.validate(runtime, makeMessage('AEGIS BRIEFING'), state)).toBe(true);
    });

    test('handles null text gracefully', async () => {
        const msg = { content: { text: null } } as any;
        expect(await action.validate(runtime, msg, state)).toBe(false);
    });

    test('handles undefined text gracefully', async () => {
        const msg = { content: {} } as any;
        expect(await action.validate(runtime, msg, state)).toBe(false);
    });
});

// ==========================================
// Plugin structure
// ==========================================
describe('aegisBriefingPlugin', () => {
    test('has correct name', () => {
        expect(aegisBriefingPlugin.name).toBe('aegis-briefing');
    });

    test('has one action', () => {
        expect(aegisBriefingPlugin.actions).toHaveLength(1);
        expect(aegisBriefingPlugin.actions![0].name).toBe('AEGIS_BRIEFING');
    });

    test('has one provider', () => {
        expect(aegisBriefingPlugin.providers).toHaveLength(1);
    });

    test('init does not throw', async () => {
        await expect(aegisBriefingPlugin.init!({} as any)).resolves.toBeUndefined();
    });
});

// ==========================================
// Edge cases: boundary scores and special data
// ==========================================
describe('edge cases', () => {
    test('formatIndividualBriefing with 0% quality rate', () => {
        const briefing = makeIndividualBriefing({
            summary: { totalEvaluated: 10, totalBurned: 10, qualityRate: 0 },
        });
        const result = formatIndividualBriefing(briefing, 5);
        expect(result).toContain('品質率: 0.0%');
    });

    test('formatIndividualBriefing with 100% quality rate', () => {
        const briefing = makeIndividualBriefing({
            summary: { totalEvaluated: 10, totalBurned: 0, qualityRate: 1.0 },
        });
        const result = formatIndividualBriefing(briefing, 5);
        expect(result).toContain('品質率: 100.0%');
    });

    test('formatGlobalBriefing with score 0', () => {
        const briefing = makeGlobalBriefing({
            contributors: [{
                principal: 'p1',
                generatedAt: '2026-03-13T10:00:00Z',
                summary: { totalEvaluated: 1, totalBurned: 0, qualityRate: 0 },
                topItems: [
                    { title: 'Zero Score', topics: ['test'], briefingScore: 0, verdict: 'slop' },
                ],
            }],
        });
        const result = formatGlobalBriefing(briefing, 5);
        expect(result).toContain('スコア: 0.0/10');
    });

    test('formatIndividualBriefing with score 10', () => {
        const briefing = makeIndividualBriefing({
            items: [makeItem({ briefingScore: 10 })],
        });
        const result = formatIndividualBriefing(briefing, 1);
        expect(result).toContain('スコア: 10.0/10');
    });

    test('serendipity pick with long content is truncated to 200', () => {
        const longContent = 'B'.repeat(300);
        const briefing = makeIndividualBriefing({
            serendipityPick: makeItem({ title: 'Serendipity', content: longContent }),
        });
        const result = formatIndividualBriefing(briefing, 5);
        expect(result).toContain('B'.repeat(200) + '...');
        expect(result).not.toContain('B'.repeat(201));
    });

    test('item with many topics', () => {
        const manyTopics = Array.from({ length: 20 }, (_, i) => `topic${i}`);
        const briefing = makeIndividualBriefing({
            items: [makeItem({ topics: manyTopics })],
        });
        const result = formatIndividualBriefing(briefing, 1);
        expect(result).toContain('topic0, topic1');
    });

    test('item with empty topics array', () => {
        const briefing = makeIndividualBriefing({
            items: [makeItem({ topics: [] })],
        });
        const result = formatIndividualBriefing(briefing, 1);
        expect(result).toContain('トピック: \n'); // empty topics list
    });
});
