import type { Plugin } from '@elizaos/core';
import {
    type Action,
    type ActionResult,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type Provider,
    type State,
    logger,
} from '@elizaos/core';

// --- Configuration
const AEGIS_CONFIG = {
    BASE_URL: process.env.AEGIS_BASE_URL || 'https://aegis.dwebxr.xyz',
    // ICP Principal (optional) — when set, fetches that user's briefing;
    // when empty, fetches the global aggregated briefing from all D2A opt-in users.
    IC_PRINCIPAL: process.env.AEGIS_IC_PRINCIPAL || '',
    // x402 payment wallet private key (for signing USDC payments)
    WALLET_PRIVATE_KEY: process.env.AEGIS_WALLET_PRIVATE_KEY || '',
    // Max payment amount in USDC (default 0.01)
    MAX_PAYMENT: process.env.AEGIS_MAX_PAYMENT || '0.01',
    // How many top items to show in chat
    CHAT_ITEM_LIMIT: parseInt(process.env.AEGIS_CHAT_ITEM_LIMIT || '5', 10),
    // Default page size for global briefing pagination
    PAGE_LIMIT: parseInt(process.env.AEGIS_PAGE_LIMIT || '20', 10),
    // Cache TTL in milliseconds (default 5 minutes)
    CACHE_TTL: parseInt(process.env.AEGIS_CACHE_TTL || '300000', 10),
};

// --- Types — Individual Briefing (per-principal)
export interface AegisBriefingScores {
    originality: number;
    insight: number;
    credibility: number;
    composite: number;
    vSignal?: number;
    cContext?: number;
    lSlop?: number;
}

export interface AegisBriefingItem {
    title: string;
    content: string;
    source?: string;
    sourceUrl?: string;
    topics: string[];
    briefingScore: number;
    scores: AegisBriefingScores;
    verdict: 'quality' | 'slop';
    reason?: string;
}

export interface AegisBriefingSummary {
    totalEvaluated: number;
    totalBurned: number;
    qualityRate: number;
}

export interface AegisBriefingMeta {
    scoringModel?: string;
    nostrPubkey?: string;
    topics?: string[];
}

/** Response when ?principal=xxx is specified */
export interface AegisIndividualBriefing {
    version: string;
    generatedAt: string;
    source?: string;
    sourceUrl?: string;
    summary: AegisBriefingSummary;
    items: AegisBriefingItem[];
    serendipityPick?: AegisBriefingItem | null;
    meta?: AegisBriefingMeta;
}

// --- Types — Global Briefing (aggregated)
export interface AegisGlobalContributorItem {
    title: string;
    topics: string[];
    briefingScore: number;
    verdict: 'quality' | 'slop';
    sourceUrl?: string;
}

export interface AegisGlobalContributor {
    principal: string;
    generatedAt: string;
    summary: AegisBriefingSummary;
    topItems: AegisGlobalContributorItem[];
}

export interface AegisGlobalPagination {
    offset: number;
    limit: number;
    total: number;
}

/** Response when no principal is specified (global aggregated) */
export interface AegisGlobalBriefing {
    version: string;
    type: 'global';
    generatedAt: string;
    pagination: AegisGlobalPagination;
    contributors: AegisGlobalContributor[];
    aggregatedTopics: string[];
    totalEvaluated: number;
    totalQualityRate: number;
}

/** Union type for either response shape */
export type AegisBriefingResponse = AegisIndividualBriefing | AegisGlobalBriefing;

export function isGlobalBriefing(data: AegisBriefingResponse): data is AegisGlobalBriefing {
    return 'type' in data && data.type === 'global';
}

// --- Simple in-memory cache
let cachedBriefing: {
    data: AegisBriefingResponse;
    fetchedAt: number;
} | null = null;

function getCachedBriefing(): AegisBriefingResponse | null {
    if (!cachedBriefing) return null;
    if (Date.now() - cachedBriefing.fetchedAt > AEGIS_CONFIG.CACHE_TTL) {
        cachedBriefing = null;
        return null;
    }
    return cachedBriefing.data;
}

function setCachedBriefing(data: AegisBriefingResponse): void {
    cachedBriefing = { data, fetchedAt: Date.now() };
}

// --- x402-aware fetch helper
async function createX402Fetch(): Promise<typeof fetch> {
    if (!AEGIS_CONFIG.WALLET_PRIVATE_KEY) {
        logger.info('[Aegis] No wallet key configured - using plain fetch (dev/free mode)');
        return fetch;
    }

    try {
        const { wrapFetchWithPayment } = await import('x402-fetch');
        const { createWalletClient, http } = await import('viem');
        const { privateKeyToAccount } = await import('viem/accounts');
        const { base } = await import('viem/chains');

        const account = privateKeyToAccount(
            AEGIS_CONFIG.WALLET_PRIVATE_KEY as `0x${string}`
        );
        const walletClient = createWalletClient({
            account,
            chain: base,
            transport: http(),
        });

        const maxPayment = parseFloat(AEGIS_CONFIG.MAX_PAYMENT);
        const maxValueBaseUnits = BigInt(Math.floor(maxPayment * 1_000_000));

        const wrappedFetch = wrapFetchWithPayment(
            fetch,
            walletClient,
            maxValueBaseUnits
        );

        logger.info(`[Aegis] x402 payment enabled (max: ${maxPayment} USDC, wallet: ${account.address})`);
        return wrappedFetch as typeof fetch;
    } catch (error) {
        logger.warn('[Aegis] Failed to initialize x402-fetch, falling back to plain fetch:', error);
        return fetch;
    }
}

let x402FetchInstance: typeof fetch | null = null;

async function getX402Fetch(): Promise<typeof fetch> {
    if (!x402FetchInstance) {
        x402FetchInstance = await createX402Fetch();
    }
    return x402FetchInstance;
}

// --- API Client Functions

/**
 * Fetch briefing from Aegis D2A API.
 * - If AEGIS_IC_PRINCIPAL is set: fetches that specific user's briefing.
 * - If not set: fetches the global aggregated briefing from all D2A opt-in users.
 */
export async function fetchAegisBriefing(options?: {
    offset?: number;
    limit?: number;
}): Promise<AegisBriefingResponse> {
    const cached = getCachedBriefing();
    if (cached) {
        logger.info('[Aegis] Returning cached briefing');
        return cached;
    }

    const fetchFn = await getX402Fetch();
    const url = new URL(`${AEGIS_CONFIG.BASE_URL}/api/d2a/briefing`);

    if (AEGIS_CONFIG.IC_PRINCIPAL) {
        // Per-user mode
        url.searchParams.set('principal', AEGIS_CONFIG.IC_PRINCIPAL);
        logger.info(`[Aegis] Fetching individual briefing for principal: ${AEGIS_CONFIG.IC_PRINCIPAL}`);
    } else {
        // Global aggregated mode
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? AEGIS_CONFIG.PAGE_LIMIT;
        if (offset > 0) url.searchParams.set('offset', String(offset));
        if (limit !== 20) url.searchParams.set('limit', String(limit));
        logger.info(`[Aegis] Fetching global briefing (offset=${offset}, limit=${limit})`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
        res = await fetchFn(url.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
            `Aegis briefing request failed: ${res.status} ${res.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`
        );
    }

    const data = (await res.json()) as AegisBriefingResponse;

    // Validate based on response type
    if (isGlobalBriefing(data)) {
        if (!Array.isArray(data.contributors)) {
            throw new Error('Invalid Aegis global briefing: missing contributors array');
        }
    } else {
        if (!Array.isArray(data.items)) {
            throw new Error('Invalid Aegis individual briefing: missing items array');
        }
    }

    setCachedBriefing(data);

    if (isGlobalBriefing(data)) {
        logger.info(
            `[Aegis] Global briefing fetched: ${data.contributors.length} contributors, ` +
            `${data.totalEvaluated} total evaluated, quality rate ${(data.totalQualityRate * 100).toFixed(1)}%`
        );
    } else {
        logger.info(
            `[Aegis] Individual briefing fetched: ${data.items.length} items, ` +
            `quality rate ${(data.summary.qualityRate * 100).toFixed(1)}%`
        );
    }

    return data;
}

/**
 * Fetch an individual briefing for a specific contributor principal.
 * Used to get sourceUrl for items found in the global briefing.
 */
export async function fetchIndividualBriefing(principal: string): Promise<AegisIndividualBriefing | null> {
    try {
        const fetchFn = await getX402Fetch();
        const url = new URL(`${AEGIS_CONFIG.BASE_URL}/api/d2a/briefing`);
        url.searchParams.set('principal', principal);
        logger.info(`[Aegis] Fetching individual briefing for principal: ${principal}`);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        let res: Response;
        try {
            res = await fetchFn(url.toString(), {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }

        if (!res.ok) {
            logger.warn(`[Aegis] Individual briefing fetch failed: ${res.status}`);
            return null;
        }

        const data = (await res.json()) as AegisIndividualBriefing;
        if (!Array.isArray(data.items)) {
            return null;
        }
        return data;
    } catch (error: any) {
        logger.warn(`[Aegis] Failed to fetch individual briefing: ${error.message}`);
        return null;
    }
}

/**
 * Check Aegis health (free endpoint).
 */
export async function checkAegisHealth(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(`${AEGIS_CONFIG.BASE_URL}/api/d2a/health`, {
            method: 'GET',
            signal: controller.signal,
        });
        clearTimeout(timer);
        return res.ok;
    } catch (error: any) {
        logger.warn(`[Aegis] Health check failed: ${error.message}`);
        return false;
    }
}

// --- Response Formatting

/**
 * Format an individual (per-principal) briefing for chat.
 */
function formatIndividualBriefing(briefing: AegisIndividualBriefing, limit: number): string {
    const items = [...briefing.items]
        .sort((a, b) => b.briefingScore - a.briefingScore)
        .slice(0, limit);

    const lines: string[] = [];

    lines.push(
        `**Aegis D2A Briefing** (${new Date(briefing.generatedAt).toLocaleString('ja-JP')})\n` +
        `評価数: ${briefing.summary.totalEvaluated}件 | ` +
        `品質率: ${(briefing.summary.qualityRate * 100).toFixed(1)}% | ` +
        `除外: ${briefing.summary.totalBurned}件`
    );

    items.forEach((item, idx) => {
        const contentPreview = item.content.length > 280
            ? item.content.slice(0, 280) + '...'
            : item.content;
        const sourceLink = item.sourceUrl
            ? `\n[続きを読む](${item.sourceUrl})`
            : '';
        lines.push(
            `\n**[${idx + 1}] ${item.title}**\n` +
            `トピック: ${item.topics.join(', ')}\n` +
            `スコア: ${item.briefingScore.toFixed(1)}/10` +
            ` (独自性:${item.scores.originality} 洞察:${item.scores.insight} 信頼性:${item.scores.credibility})\n` +
            `${contentPreview}${sourceLink}`
        );
    });

    if (briefing.serendipityPick) {
        const s = briefing.serendipityPick;
        const serendipityLink = s.sourceUrl
            ? `\n[続きを読む](${s.sourceUrl})`
            : '';
        lines.push(
            `\n---\n` +
            `**セレンディピティ枠: ${s.title}**\n` +
            `トピック: ${s.topics.join(', ')}\n` +
            `スコア: ${s.briefingScore.toFixed(1)}/10\n` +
            `${s.content.length > 200 ? s.content.slice(0, 200) + '...' : s.content}${serendipityLink}`
        );
    }

    if (briefing.meta?.scoringModel) {
        lines.push(`\n_Scoring: ${briefing.meta.scoringModel}_`);
    }

    return lines.join('\n');
}

/**
 * Format a global (aggregated) briefing for chat.
 */
function formatGlobalBriefing(briefing: AegisGlobalBriefing, itemLimit: number): string {
    const lines: string[] = [];

    lines.push(
        `**Aegis D2A グローバルブリーフィング** (${new Date(briefing.generatedAt).toLocaleString('ja-JP')})\n` +
        `参加者: ${briefing.pagination.total}人 | ` +
        `総評価数: ${briefing.totalEvaluated}件 | ` +
        `品質率: ${(briefing.totalQualityRate * 100).toFixed(1)}%`
    );

    if (briefing.aggregatedTopics.length > 0) {
        lines.push(`注目トピック: ${briefing.aggregatedTopics.slice(0, 8).join(', ')}`);
    }

    // Collect all items from all contributors, sort by score, pick top N
    const allItems: (AegisGlobalContributorItem & { contributorPrincipal: string })[] = [];
    for (const c of briefing.contributors) {
        for (const item of c.topItems) {
            allItems.push({ ...item, contributorPrincipal: c.principal });
        }
    }
    allItems.sort((a, b) => b.briefingScore - a.briefingScore);
    const topItems = allItems.slice(0, itemLimit);

    topItems.forEach((item, idx) => {
        const sourceLink = item.sourceUrl
            ? ` | [続きを読む](${item.sourceUrl})`
            : '';
        lines.push(
            `\n**[${idx + 1}] ${item.title}**\n` +
            `トピック: ${item.topics.join(', ')}\n` +
            `スコア: ${item.briefingScore.toFixed(1)}/10 | 判定: ${item.verdict === 'quality' ? '高品質' : 'slop'}${sourceLink}`
        );
    });

    const { offset, limit, total } = briefing.pagination;
    if (total > offset + limit) {
        lines.push(`\n_さらに ${total - offset - limit} 人の参加者のデータがあります_`);
    }

    return lines.join('\n');
}

/**
 * Format any briefing response for chat display.
 */
export function formatBriefingForChat(
    briefing: AegisBriefingResponse,
    limit: number = AEGIS_CONFIG.CHAT_ITEM_LIMIT,
): string {
    if (isGlobalBriefing(briefing)) {
        return formatGlobalBriefing(briefing, limit);
    }
    return formatIndividualBriefing(briefing, limit);
}

// --- Action: AEGIS_BRIEFING
const aegisBriefingAction: Action = {
    name: 'AEGIS_BRIEFING',
    similes: [
        'GET_BRIEFING', 'AEGIS_NEWS', 'QUALITY_NEWS',
        'ブリーフィング', 'ニュース取得', '高品質情報',
        'D2A_BRIEFING', 'AEGIS_REPORT',
    ],
    description:
        'Fetches a curated, quality-scored briefing from the Aegis D2A API. ' +
        'Use this when the user asks about news, trends, AI developments, crypto updates, ' +
        'or any high-quality external information. Aegis filters out low-quality content (slop) ' +
        'and returns only verified, high-scoring items from all D2A opt-in users.',

    validate: async (
        _runtime: IAgentRuntime,
        message: Memory,
        _state: State,
    ): Promise<boolean> => {
        const text = (message.content.text || '').toLowerCase();

        const triggers = [
            'aegis', 'ブリーフィング', 'briefing',
            '最新ニュース', '最新情報', 'latest news',
            '高品質', 'quality news', 'quality report',
            'd2a', 'トレンド', 'trends',
            '情報収集', 'research', 'リサーチ',
            '今日のニュース', "today's news",
            'what is happening', '何が起きて',
        ];

        const matched = triggers.some(t => text.includes(t));
        if (matched) {
            logger.info(`[Aegis] Action validated for: "${text.slice(0, 50)}..."`);
        }
        return matched;
    },

    handler: async (
        _runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[],
    ): Promise<ActionResult> => {
        try {
            const healthy = await checkAegisHealth();
            if (!healthy) {
                await callback({
                    text: 'Aegis D2A サービスに接続できません。しばらくしてからもう一度お試しください。',
                    source: message.content.source,
                });
                return { success: false };
            }

            const briefing = await fetchAegisBriefing();
            const formatted = formatBriefingForChat(briefing);

            await callback({
                text: formatted,
                source: message.content.source,
            });

            if (isGlobalBriefing(briefing)) {
                logger.info(`[Aegis] Global briefing delivered: ${briefing.contributors.length} contributors`);
            } else {
                logger.info(`[Aegis] Individual briefing delivered: ${briefing.items.length} items`);
            }
            return { success: true };
        } catch (error: any) {
            logger.error('[Aegis] Briefing fetch failed:', error);

            let errorMsg: string;
            if (error.message?.includes('402')) {
                errorMsg = 'Aegis D2A ブリーフィングの取得に x402 決済が必要ですが、ウォレットが設定されていません。管理者に AEGIS_WALLET_PRIVATE_KEY の設定を確認してください。';
            } else if (error.message?.includes('404')) {
                errorMsg = 'ブリーフィングデータがまだありません。Aegis で D2A をオプトインしたユーザーがコンテンツの評価・同期を行うとデータが利用可能になります。';
            } else {
                errorMsg = `Aegis D2A ブリーフィングの取得に失敗しました: ${error.message}`;
            }

            await callback({
                text: errorMsg,
                source: message.content.source,
            });
            return { success: false };
        }
    },

    examples: [
        [
            {
                name: '{{user1}}',
                content: { text: '最新のブリーフィングを見せて' },
            },
            {
                name: 'Coo',
                content: {
                    text: 'Aegis D2A からグローバルブリーフィングを取得します。全参加者の品質フィルタ済み情報をお見せしますね。',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: { text: 'What are the latest trends in AI?' },
            },
            {
                name: 'Coo',
                content: {
                    text: "Let me fetch the latest quality-scored briefing from Aegis D2A to give you verified insights on AI trends.",
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: { text: '今日の高品質ニュースは？' },
            },
            {
                name: 'Coo',
                content: {
                    text: 'Aegis のグローバルブリーフィングを確認します。D2A参加者がフィルタした高品質情報をお届けします。',
                },
            },
        ],
    ],
};

// --- Provider: Aegis Briefing Context
const aegisBriefingProvider: Provider = {
    // @ts-ignore - elizaOS Provider name typing
    name: 'aegisBriefingProvider',
    get: async (
        _runtime: IAgentRuntime,
        _message: Memory,
        _state?: State,
    ) => {
        const cached = getCachedBriefing();
        if (!cached) {
            return { text: '', values: {}, data: {} };
        }

        let contextSummary: string;
        if (isGlobalBriefing(cached)) {
            const topTopics = cached.aggregatedTopics.slice(0, 5).join(', ');
            contextSummary =
                `[Aegis D2A Global] ${cached.contributors.length}人の参加者から集約, ` +
                `総評価数 ${cached.totalEvaluated}件, ` +
                `品質率 ${(cached.totalQualityRate * 100).toFixed(1)}%, ` +
                `注目トピック: ${topTopics}`;
        } else {
            const topTopics = [...new Set(cached.items.flatMap(i => i.topics))].slice(0, 5).join(', ');
            contextSummary =
                `[Aegis D2A] ${cached.items.length}件の高品質アイテム, ` +
                `品質率 ${(cached.summary.qualityRate * 100).toFixed(1)}%, ` +
                `トップトピック: ${topTopics}`;
        }

        return {
            text: contextSummary,
            values: {
                hasAegisBriefing: true,
                aegisBriefingAge: Date.now() - (cachedBriefing?.fetchedAt || 0),
                aegisBriefingMode: isGlobalBriefing(cached) ? 'global' : 'individual',
            },
            data: {
                briefingType: isGlobalBriefing(cached) ? 'global' : 'individual',
            },
        };
    },
};

// --- Plugin Export
export const aegisBriefingPlugin: Plugin = {
    name: 'aegis-briefing',
    description:
        'Aegis D2A Briefing API client with x402 payment support. ' +
        'Fetches global aggregated briefings from all D2A opt-in users, or a specific user briefing when AEGIS_IC_PRINCIPAL is set.',
    actions: [aegisBriefingAction],
    providers: [aegisBriefingProvider],
    init: async () => {
        const mode = AEGIS_CONFIG.IC_PRINCIPAL ? `individual (${AEGIS_CONFIG.IC_PRINCIPAL})` : 'global';
        const wallet = AEGIS_CONFIG.WALLET_PRIVATE_KEY ? 'configured' : 'not set';
        logger.info(`[Aegis] Plugin initialized — ${AEGIS_CONFIG.BASE_URL} | mode=${mode} | x402=${wallet} | cacheTTL=${AEGIS_CONFIG.CACHE_TTL / 1000}s`);

        try {
            const healthy = await checkAegisHealth();
            if (!healthy) logger.warn('[Aegis] Health check: UNREACHABLE');
        } catch (error: any) {
            logger.warn(`[Aegis] Health check failed on startup: ${error?.message || error}`);
        }
    },
};

export default aegisBriefingPlugin;

// --- Test-only exports ---
export const _testExports = {
    getCachedBriefing,
    setCachedBriefing,
    formatIndividualBriefing,
    formatGlobalBriefing,
    AEGIS_CONFIG,
    resetCache: () => { cachedBriefing = null; },
};
