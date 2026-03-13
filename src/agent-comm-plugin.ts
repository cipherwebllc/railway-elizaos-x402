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

const CONFIG = {
    get ELIZA_CLOUD_API_URL(): string {
        return process.env.ELIZA_CLOUD_API_URL || '';
    },
    get ELIZA_CLOUD_AGENT_ID(): string {
        return process.env.ELIZA_CLOUD_AGENT_ID || 'coo-cloud';
    },
    API_TIMEOUT: 30000,
    PROTOCOL: 'dwebxr-agent-comm',
};

interface AgentMessage {
    protocol: string;
    from: string;
    to: string;
    type: 'query' | 'response' | 'instruction' | 'report';
    content: string;
    metadata?: Record<string, any>;
    timestamp: string;
}

interface AgentResponse {
    success: boolean;
    message?: string;
    data?: any;
    error?: string;
}

async function sendToElizaCloud(
    message: AgentMessage,
    agentName: string
): Promise<AgentResponse> {
    const apiUrl = `${CONFIG.ELIZA_CLOUD_API_URL}/api/agents/${CONFIG.ELIZA_CLOUD_AGENT_ID}/message`;

    logger.info(`[AGENT_COMM:${agentName}] Sending message to Eliza Cloud: ${apiUrl}`);
    logger.info(`[AGENT_COMM:${agentName}] Message type: ${message.type}, content: ${message.content.substring(0, 100)}...`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Agent-Protocol': CONFIG.PROTOCOL,
                'X-Agent-From': agentName,
            },
            body: JSON.stringify(message),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`[AGENT_COMM:${agentName}] API error: ${response.status} - ${errorText}`);
            return {
                success: false,
                error: `API error: ${response.status}`,
            };
        }

        const data = await response.json();
        logger.info(`[AGENT_COMM:${agentName}] Received response from Eliza Cloud`);

        return {
            success: true,
            message: data.text || data.message,
            data: data,
        };
    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.error(`[AGENT_COMM:${agentName}] Request timeout after ${CONFIG.API_TIMEOUT}ms`);
            return {
                success: false,
                error: 'Request timeout - Eliza Cloud did not respond in time',
            };
        }

        logger.error(`[AGENT_COMM:${agentName}] Network error:`, error);
        return {
            success: false,
            error: `Network error: ${error.message}`,
        };
    }
}

// Uses stricter matching to avoid false positives
function isElizaCloudRequest(text: string): boolean {
    const lowerText = text.toLowerCase();

    const directMention =
        lowerText.includes('eliza cloud') ||
        lowerText.includes('elizacloud') ||
        lowerText.includes('cloud coo') ||
        lowerText.includes('クラウドcoo') ||
        lowerText.includes('クラウド coo') ||
        lowerText.includes('eliza クラウド');

    if (directMention) {
        return true;
    }

    const hasCloudContext =
        lowerText.includes('cloud') ||
        lowerText.includes('クラウド') ||
        lowerText.includes('remote') ||
        lowerText.includes('リモート') ||
        lowerText.includes('外部') ||
        lowerText.includes('連携');

    const hasDataRequest =
        lowerText.includes('market data') ||
        lowerText.includes('マーケットデータ') ||
        lowerText.includes('市場データ') ||
        lowerText.includes('ガス代') ||
        lowerText.includes('gas fee') ||
        lowerText.includes('real-time') ||
        lowerText.includes('リアルタイム');

    const hasFetchIntent =
        (lowerText.includes('から') && hasDataRequest) ||
        (lowerText.includes('from') && hasDataRequest) ||
        lowerText.includes('取得して') ||
        lowerText.includes('確認して');

    return (hasCloudContext && hasDataRequest) || (hasFetchIntent && hasCloudContext);
}

const queryElizaCloudAction: Action = {
    name: 'QUERY_ELIZA_CLOUD',
    similes: [
        'ASK_ELIZA_CLOUD',
        'ELIZA_CLOUD_QUERY',
        'GET_MARKET_DATA',
        'GET_GAS_ESTIMATE',
        'CLOUD_COO_QUERY',
    ],
    description: `Query Eliza Cloud Coo for real-time market data, gas estimates, or other operational information.
Use this when users ask about:
- Real-time price data or market conditions
- Gas fee estimates
- On-chain operation preparation
- Market analysis that requires live data`,

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const agentName = runtime.character?.name || 'unknown';
        const text = (message.content.text || '').toLowerCase();

        return isElizaCloudRequest(text);
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        const agentName = runtime.character?.name || 'unknown';
        const userText = message.content.text || '';

        logger.info(`[QUERY_ELIZA_CLOUD:${agentName}] Processing query: "${userText.substring(0, 100)}..."`);

        const agentMessage: AgentMessage = {
            protocol: CONFIG.PROTOCOL,
            from: agentName,
            to: 'Eliza Cloud Coo',
            type: 'query',
            content: userText,
            metadata: {
                roomId: message.roomId,
                userId: (message as any).userId || (message as any).authorId,
            },
            timestamp: new Date().toISOString(),
        };

        if (!CONFIG.ELIZA_CLOUD_API_URL) {
            await callback({
                text: `📡 Eliza Cloud Cooへのクエリを準備しています...\n\n⚠️ 現在、Eliza Cloud APIが設定されていません。管理者にELIZA_CLOUD_API_URL環境変数の設定を依頼してください。\n\nお問い合わせ内容: "${userText.substring(0, 100)}..."`,
                source: message.content.source,
            });
            return { success: false };
        }

        await callback({
            text: `📡 Eliza Cloud Cooにクエリを送信中...\n\nお問い合わせ内容: "${userText.substring(0, 100)}..."`,
            source: message.content.source,
        });

        const response = await sendToElizaCloud(agentMessage, agentName);

        if (response.success) {
            await callback({
                text: `✅ **Eliza Cloud Cooからの応答**\n\n${response.message || 'データを受信しました。'}${response.data?.analysis ? `\n\n📊 分析:\n${response.data.analysis}` : ''}`,
                source: message.content.source,
            });
            return { success: true };
        } else {
            await callback({
                text: `⚠️ Eliza Cloud Cooへの接続に問題が発生しました。\n\nエラー: ${response.error}\n\n後でもう一度お試しください。`,
                source: message.content.source,
            });
            return { success: false };
        }
    },

    examples: [
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Get me the current ETH gas fees from Eliza Cloud',
                },
            },
            {
                name: '{{agent}}',
                content: {
                    text: '📡 Eliza Cloud Cooにガス代の情報をリクエストしています...',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'リアルタイムのUSDC/JPY価格を教えて',
                },
            },
            {
                name: '{{agent}}',
                content: {
                    text: '📡 Eliza Cloud Cooにマーケットデータをリクエストしています...',
                },
            },
        ],
    ],
};

const sendInstructionAction: Action = {
    name: 'SEND_CLOUD_INSTRUCTION',
    similes: [
        'INSTRUCT_ELIZA_CLOUD',
        'CLOUD_OPERATION',
        'PREPARE_OPERATION',
    ],
    description: `Send operational instructions to Eliza Cloud Coo for operation preparation.
Only available for Dliza (Commander). Use for:
- Preparing swap/trade operations
- Setting up wallet operation parameters
- Coordinating multi-step operations`,

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const agentName = runtime.character?.name || 'unknown';

        if (agentName !== 'Dliza') {
            return false;
        }

        const text = (message.content.text || '').toLowerCase();

        const isOperationRequest =
            text.includes('prepare') ||
            text.includes('準備') ||
            text.includes('swap') ||
            text.includes('スワップ') ||
            text.includes('execute') ||
            text.includes('実行') ||
            text.includes('operation') ||
            text.includes('オペレーション');

        return isOperationRequest && isElizaCloudRequest(text);
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        const agentName = runtime.character?.name || 'unknown';
        const userText = message.content.text || '';

        logger.info(`[SEND_INSTRUCTION:${agentName}] Sending instruction: "${userText.substring(0, 100)}..."`);

        const agentMessage: AgentMessage = {
            protocol: CONFIG.PROTOCOL,
            from: agentName,
            to: 'Eliza Cloud Coo',
            type: 'instruction',
            content: userText,
            metadata: {
                priority: 'high',
                roomId: message.roomId,
            },
            timestamp: new Date().toISOString(),
        };

        if (!CONFIG.ELIZA_CLOUD_API_URL) {
            await callback({
                text: `📋 **オペレーション指示を準備中**\n\n⚠️ Eliza Cloud APIが設定されていません。\n\n指示内容: "${userText.substring(0, 100)}..."\n\nEliza Cloud Cooへの接続後、この指示を実行します。`,
                source: message.content.source,
            });
            return { success: false };
        }

        await callback({
            text: `📋 **Eliza Cloud Cooへ指示を送信中...**\n\n指示内容: "${userText.substring(0, 100)}..."`,
            source: message.content.source,
        });

        const response = await sendToElizaCloud(agentMessage, agentName);

        if (response.success) {
            await callback({
                text: `✅ **指示が受理されました**\n\n${response.message || 'Eliza Cloud Cooが指示を受け付けました。'}${response.data?.status ? `\n\nステータス: ${response.data.status}` : ''}`,
                source: message.content.source,
            });
            return { success: true };
        } else {
            await callback({
                text: `⚠️ **指示の送信に失敗しました**\n\nエラー: ${response.error}\n\n後でもう一度お試しください。`,
                source: message.content.source,
            });
            return { success: false };
        }
    },

    examples: [
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Prepare a swap of 100 USDC to ETH on Base via Eliza Cloud',
                },
            },
            {
                name: 'Dliza',
                content: {
                    text: '📋 Eliza Cloud Cooへスワップ準備の指示を送信しています...',
                },
            },
        ],
    ],
};

const agentCommProvider: Provider = {
    // @ts-ignore
    name: 'agentCommProvider',
    get: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
        const text = (message.content.text || '').toLowerCase();

        if (isElizaCloudRequest(text)) {
            const cloudStatus = CONFIG.ELIZA_CLOUD_API_URL
                ? '接続可能'
                : '未設定（ELIZA_CLOUD_API_URL環境変数が必要）';

            return {
                text: `【エージェント間通信】Eliza Cloud Cooとの通信が可能です。ステータス: ${cloudStatus}`,
                values: {
                    canCommunicateWithCloud: !!process.env.ELIZA_CLOUD_API_URL,
                    protocol: CONFIG.PROTOCOL,
                },
                data: {
                    elizaCloudUrl: CONFIG.ELIZA_CLOUD_API_URL,
                    agentId: CONFIG.ELIZA_CLOUD_AGENT_ID,
                },
            };
        }

        return { text: '', values: {}, data: {} };
    },
};

export const agentCommPlugin: Plugin = {
    name: 'agent-comm',
    description: 'Agent-to-Agent Communication Plugin for dWebXR team. Enables Railway agents to communicate with Eliza Cloud Coo via URL-based API calls.',
    actions: [queryElizaCloudAction, sendInstructionAction],
    providers: [agentCommProvider],
    init: async (_config: Record<string, string>) => {
        logger.info('*** Agent Communication Plugin Initialized ***');
        logger.info(`*** Protocol: ${CONFIG.PROTOCOL} ***`);
        logger.info(`*** Eliza Cloud URL: ${CONFIG.ELIZA_CLOUD_API_URL || '(not set)'} ***`);
        logger.info(`*** Eliza Cloud Agent ID: ${CONFIG.ELIZA_CLOUD_AGENT_ID} ***`);

        if (!CONFIG.ELIZA_CLOUD_API_URL) {
            logger.warn('*** ELIZA_CLOUD_API_URL not set - Agent communication will be simulated ***');
        }
    },
};

export default agentCommPlugin;
