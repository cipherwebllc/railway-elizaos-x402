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

// ============================================
// Configuration
// ============================================
const AEGIS_CONFIG = {
    BASE_URL: process.env.AEGIS_BASE_URL || 'https://aegis.dwebxr.xyz',
    // x402 payment wallet private key (for signing USDC payments)
    WALLET_PRIVATE_KEY: process.env.AEGIS_WALLET_PRIVATE_KEY || '',
    // Max payment amount in USDC base units (default 0.01 USDC)
    MAX_PAYMENT: process.env.AEGIS_MAX_PAYMENT || '0.01',
    // How many top items to show in chat
    CHAT_ITEM_LIMIT: parseInt(process.env.AEGIS_CHAT_ITEM_LIMIT || '5', 10),
    // Cache TTL in milliseconds (default 5 minutes)
    CACHE_TTL: parseInt(process.env.AEGIS_CACHE_TTL || '300000', 10),
};

// ============================================
// Types
// ============================================
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
    topics: string[];
    briefingScore: number;
    scores: AegisBriefingScores;
    verdict: 'quality' | 'slop';
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

export interface AegisBriefingResponse {
    version: string;
    generatedAt: string;
    summary: AegisBriefingSummary;
    items: AegisBriefingItem[];
    serendipityPick?: AegisBriefingItem;
    meta?: AegisBriefingMeta;
}

export interface AegisInfoResponse {
    name?: string;
    description?: string;
    version?: string;
    price?: string | number;
    currency?: string;
    network?: string;
    endpoints?: Record<string, string>;
}

// ============================================
// Simple in-memory cache
// ============================================
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

// ============================================
// x402-aware fetch helper
// ============================================

/**
 * Creates a fetch function that handles x402 payment flow.
 * If AEGIS_WALLET_PRIVATE_KEY is set, uses x402-fetch with viem wallet.
 * Otherwise, falls back to plain fetch (works for dev/free Aegis instances).
 */
async function createX402Fetch(): Promise<typeof fetch> {
    if (!AEGIS_CONFIG.WALLET_PRIVATE_KEY) {
        logger.info('[Aegis] No wallet key configured - using plain fetch (dev/free mode)');
        return fetch;
    }

    try {
        // Dynamic imports to avoid breaking when deps aren't installed
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
        // x402-fetch expects maxValue in USDC base units (6 decimals)
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

// Lazy-initialized x402 fetch instance
let x402FetchInstance: typeof fetch | null = null;

async function getX402Fetch(): Promise<typeof fetch> {
    if (!x402FetchInstance) {
        x402FetchInstance = await createX402Fetch();
    }
    return x402FetchInstance;
}

// ============================================
// API Client Functions
// ============================================

/**
 * Fetch the Aegis D2A Briefing (main paid endpoint).
 */
export async function fetchAegisBriefing(): Promise<AegisBriefingResponse> {
    // Check cache first
    const cached = getCachedBriefing();
    if (cached) {
        logger.info('[Aegis] Returning cached briefing');
        return cached;
    }

    const fetchFn = await getX402Fetch();
    const url = `${AEGIS_CONFIG.BASE_URL}/api/d2a/briefing`;

    logger.info(`[Aegis] Fetching briefing from ${url}`);

    const res = await fetchFn(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
        },
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
            `Aegis briefing request failed: ${res.status} ${res.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`
        );
    }

    const data = (await res.json()) as AegisBriefingResponse;

    if (!data || !Array.isArray(data.items)) {
        throw new Error('Invalid Aegis briefing response: missing items array');
    }

    setCachedBriefing(data);
    logger.info(`[Aegis] Briefing fetched: ${data.items.length} items, quality rate ${(data.summary.qualityRate * 100).toFixed(1)}%`);

    return data;
}

/**
 * Fetch Aegis service info (free endpoint).
 */
export async function fetchAegisInfo(): Promise<AegisInfoResponse> {
    const res = await fetch(`${AEGIS_CONFIG.BASE_URL}/api/d2a/info`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
        throw new Error(`Aegis info request failed: ${res.status}`);
    }

    return (await res.json()) as AegisInfoResponse;
}

/**
 * Check Aegis health (free endpoint).
 */
export async function checkAegisHealth(): Promise<boolean> {
    try {
        const res = await fetch(`${AEGIS_CONFIG.BASE_URL}/api/d2a/health`, {
            method: 'GET',
        });
        return res.ok;
    } catch {
        return false;
    }
}

// ============================================
// Response Formatting
// ============================================

/**
 * Format a briefing response for chat display.
 * Returns a structured summary suitable for agent conversation.
 */
export function formatBriefingForChat(
    briefing: AegisBriefingResponse,
    limit: number = AEGIS_CONFIG.CHAT_ITEM_LIMIT,
): string {
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
        const topics = item.topics.join(', ');
        const contentPreview = item.content.length > 280
            ? item.content.slice(0, 280) + '...'
            : item.content;
        lines.push(
            `\n**[${idx + 1}] ${item.title}**\n` +
            `トピック: ${topics}\n` +
            `スコア: ${item.briefingScore.toFixed(1)}/10` +
            ` (独自性:${item.scores.originality} 洞察:${item.scores.insight} 信頼性:${item.scores.credibility})\n` +
            `${contentPreview}`
        );
    });

    if (briefing.serendipityPick) {
        const s = briefing.serendipityPick;
        lines.push(
            `\n---\n` +
            `**セレンディピティ枠: ${s.title}**\n` +
            `トピック: ${s.topics.join(', ')}\n` +
            `スコア: ${s.briefingScore.toFixed(1)}/10\n` +
            `${s.content.length > 200 ? s.content.slice(0, 200) + '...' : s.content}`
        );
    }

    if (briefing.meta?.scoringModel) {
        lines.push(`\n_Scoring: ${briefing.meta.scoringModel}_`);
    }

    return lines.join('\n');
}

/**
 * Format briefing as structured data for agent context memory.
 */
export function formatBriefingForContext(
    briefing: AegisBriefingResponse,
    limit: number = AEGIS_CONFIG.CHAT_ITEM_LIMIT,
): string {
    const items = [...briefing.items]
        .sort((a, b) => b.briefingScore - a.briefingScore)
        .slice(0, limit);

    const contextItems = items.map(item => ({
        title: item.title,
        topics: item.topics,
        score: item.briefingScore,
        verdict: item.verdict,
        summary: item.content.slice(0, 500),
    }));

    return JSON.stringify({
        source: 'aegis-d2a',
        generatedAt: briefing.generatedAt,
        qualityRate: briefing.summary.qualityRate,
        totalEvaluated: briefing.summary.totalEvaluated,
        topItems: contextItems,
        serendipityPick: briefing.serendipityPick ? {
            title: briefing.serendipityPick.title,
            topics: briefing.serendipityPick.topics,
            score: briefing.serendipityPick.briefingScore,
        } : null,
    });
}

// ============================================
// Action: AEGIS_BRIEFING
// ============================================
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
        'and returns only verified, high-scoring items.',

    validate: async (
        _runtime: IAgentRuntime,
        message: Memory,
        _state: State,
    ): Promise<boolean> => {
        const text = (message.content.text || '').toLowerCase();

        // Trigger on explicit requests for briefing/news
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
            // Check health first
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

            logger.info(`[Aegis] Briefing delivered: ${briefing.items.length} items`);
            return { success: true };
        } catch (error: any) {
            logger.error('[Aegis] Briefing fetch failed:', error);

            const errorMsg = error.message?.includes('402')
                ? 'Aegis D2A ブリーフィングの取得に x402 決済が必要ですが、ウォレットが設定されていません。管理者に AEGIS_WALLET_PRIVATE_KEY の設定を確認してください。'
                : `Aegis D2A ブリーフィングの取得に失敗しました: ${error.message}`;

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
                    text: 'Aegis D2A からブリーフィングを取得します。品質フィルタ済みの最新情報をお見せしますね。',
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
                    text: 'Aegis のブリーフィングを確認します。低品質コンテンツはフィルタ済みなので、信頼できる情報だけをお届けします。',
                },
            },
        ],
    ],
};

// ============================================
// Provider: Aegis Briefing Context
// ============================================
const aegisBriefingProvider: Provider = {
    // @ts-ignore - elizaOS Provider name typing
    name: 'aegisBriefingProvider',
    get: async (
        _runtime: IAgentRuntime,
        _message: Memory,
        _state?: State,
    ) => {
        // Only inject cached briefing data if available
        const cached = getCachedBriefing();
        if (!cached) {
            return { text: '', values: {}, data: {} };
        }

        const contextSummary =
            `[Aegis D2A] 直近のブリーフィング: ` +
            `${cached.items.length}件の高品質アイテム, ` +
            `品質率 ${(cached.summary.qualityRate * 100).toFixed(1)}%, ` +
            `トップトピック: ${[...new Set(cached.items.flatMap(i => i.topics))].slice(0, 5).join(', ')}`;

        return {
            text: contextSummary,
            values: {
                hasAegisBriefing: true,
                aegisBriefingAge: Date.now() - (cachedBriefing?.fetchedAt || 0),
            },
            data: {
                briefingSummary: cached.summary,
                topItemCount: cached.items.length,
            },
        };
    },
};

// ============================================
// Plugin Export
// ============================================
export const aegisBriefingPlugin: Plugin = {
    name: 'aegis-briefing',
    description:
        'Aegis D2A Briefing API client with x402 payment support. ' +
        'Provides curated, quality-scored information feeds filtered by the Aegis VCL scoring model.',
    actions: [aegisBriefingAction],
    providers: [aegisBriefingProvider],
    init: async (_config: Record<string, string>) => {
        logger.info('*** Aegis Briefing Plugin Initialized ***');
        logger.info(`*** Aegis Base URL: ${AEGIS_CONFIG.BASE_URL} ***`);
        logger.info(`*** x402 wallet: ${AEGIS_CONFIG.WALLET_PRIVATE_KEY ? 'configured' : 'not set (dev/free mode)'} ***`);
        logger.info(`*** Cache TTL: ${AEGIS_CONFIG.CACHE_TTL / 1000}s ***`);

        // Optional: check health on startup
        try {
            const healthy = await checkAegisHealth();
            logger.info(`*** Aegis health: ${healthy ? 'OK' : 'UNREACHABLE'} ***`);
        } catch {
            logger.warn('*** Aegis health check failed on startup ***');
        }
    },
};

export default aegisBriefingPlugin;
