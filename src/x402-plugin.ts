import type { Plugin } from '@elizaos/core';
import {
    type Action,
    type ActionResult,
    type Content,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type Provider,
    Service,
    type State,
    logger,
} from '@elizaos/core';
import { ethers } from 'ethers';
import { startPaymentServer } from './pay-server.ts';

/**
 * Helper function to extract the actual user ID from a message
 * Prioritizes the actual sender ID over room ID for group chats
 */
function extractUserId(message: Memory): string {
    // Priority 1: Direct user identifiers (the actual sender)
    const directUserId = (message as any).userId ||
        (message as any).authorId ||
        (message as any).author_id ||
        (message.content as any)?.sourceId ||
        (message.metadata as any)?.sourceId ||
        (message.metadata as any)?.raw?.senderId;

    if (directUserId) {
        logger.info(`[extractUserId] Found direct userId: ${directUserId}`);
        return directUserId;
    }

    // Priority 2: Fall back to room ID if no sender ID found
    logger.info(`[extractUserId] No direct userId, using roomId: ${message.roomId}`);
    return message.roomId;
}

/**
 * Helper to get ALL possible user identifiers for admin login
 * In group chats, we want to mark BOTH the sender ID and room ID as admin
 */
function getAllUserIds(message: Memory): string[] {
    const ids: string[] = [];

    // Add direct user identifiers
    const directUserId = (message as any).userId ||
        (message as any).authorId ||
        (message as any).author_id ||
        (message.content as any)?.sourceId ||
        (message.metadata as any)?.sourceId ||
        (message.metadata as any)?.raw?.senderId;

    if (directUserId) {
        ids.push(directUserId);
    }

    // Always add room ID as well for group chats
    if (message.roomId && message.roomId !== directUserId) {
        ids.push(message.roomId);
    }

    logger.info(`[getAllUserIds] Collected IDs: ${ids.join(', ')}`);
    return ids;
}

/**
 * X402 Service
 * Manages payment credits for users.
 */
export class X402Service extends Service {
    static serviceType = 'x402';
    static instance: X402Service | null = null;

    // Make state static to share across all agent instances
    private static userCredits: Map<string, number> = new Map();
    private static adminUsers: Set<string> = new Set();

    capabilityDescription = 'Manages x402 payment gating for agent access';

    constructor(runtime: IAgentRuntime) {
        super(runtime);
        X402Service.instance = this;
    }

    static async start(runtime: IAgentRuntime) {
        logger.info('*** Starting X402 service ***');
        const service = new X402Service(runtime);
        return service;
    }

    static async stop(runtime: IAgentRuntime) {
        logger.info('*** Stopping X402 service ***');
        const service = runtime.getService(X402Service.serviceType);
        if (service) {
            service.stop();
        }
    }

    async stop() {
        logger.info('*** Stopping X402 service instance ***');
    }

    getCredits(userId: string): number {
        return X402Service.userCredits.get(userId) || 0;
    }

    addCredit(userId: string, amount: number = 1) {
        const current = this.getCredits(userId);
        X402Service.userCredits.set(userId, current + amount);
        logger.info(`Added ${amount} credit(s) to user: ${userId}. Total: ${current + amount}`);
    }

    consumeCredit(userId: string): boolean {
        const current = this.getCredits(userId);
        if (current > 0) {
            X402Service.userCredits.set(userId, current - 1);
            logger.info(`Consumed 1 credit from user: ${userId}. Remaining: ${current - 1}`);
            return true;
        }
        return false;
    }

    isAdmin(userId: string): boolean {
        return X402Service.adminUsers.has(userId);
    }

    setAdmin(userId: string, status: boolean) {
        if (status) {
            X402Service.adminUsers.add(userId);
            logger.info(`User ${userId} granted admin access.`);
        } else {
            X402Service.adminUsers.delete(userId);
            logger.info(`User ${userId} revoked admin access.`);
        }
    }
}

/**
 * Action: Check Payment / Gate Access
 * Intercepts requests and checks if the user has credits.
 */
const checkPaymentAction: Action = {
    name: 'CHECK_PAYMENT',
    similes: [
        'CONSULT', 'ASK_QUESTION', 'REQUEST_ADVICE', 'GET_NEWS', 'SEARCH',
        'GET_PRICE', 'GET_INFO', 'ANALYZE', 'EXPLAIN', 'HELP',
        'CRYPTO_NEWS', 'WEB_SEARCH', 'CHECK_REPUTATION', 'GET_ACTIVITIES'
    ],
    description: 'MANDATORY: Use this action when the x402Provider indicates payment is required (credits = 0 and not admin). This action has ABSOLUTE PRIORITY over all other actions when payment is required. Do NOT use if message is a long alphanumeric key or "x402-admin-secret" (those are admin keys, use ADMIN_LOGIN instead).',

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        logger.info(`[CHECK_PAYMENT] validate called`);
        const service = runtime.getService<X402Service>('x402');
        if (!service) {
            logger.info(`[CHECK_PAYMENT] Service not found, skipping`);
            return false;
        }

        const userId = extractUserId(message);

        logger.info(`[CHECK_PAYMENT] Validating for userId: ${userId}`);
        logger.info(`[CHECK_PAYMENT] Message structure: ${JSON.stringify({
            userId: (message as any).userId,
            authorId: (message as any).authorId,
            author_id: (message as any).author_id,
            roomId: message.roomId,
            contentSourceId: (message.content as any)?.sourceId,
            metadataSourceId: (message.metadata as any)?.sourceId,
            metadataRawSenderId: (message.metadata as any)?.raw?.senderId
        })}`);
        logger.info(`[CHECK_PAYMENT] Message text: "${message.content.text || ''}"`);
        logger.info(`[CHECK_PAYMENT] Extracted userId: ${userId}`);

        // Allow verification messages to pass through to the VERIFY_PAYMENT action
        const text = (message.content.text || '').toLowerCase();
        const verificationKeywords = ['支払いました', 'paid', 'payment complete'];
        if (verificationKeywords.some(k => text.includes(k))) {
            logger.info(`[CHECK_PAYMENT] Verification keyword detected, skipping`);
            return false;
        }

        // Check if user is admin
        if (service.isAdmin(userId)) {
            logger.info(`[CHECK_PAYMENT] User ${userId} is admin. Bypassing payment check.`);
            return false;
        }

        // Check if message is the ADMIN_API_KEY (Login attempt)
        const envKey = process.env.ADMIN_API_KEY;
        const fallbackKey = 'x402-admin-secret';
        const cleanedText = (message.content.text || '').trim().replace(/^["']|["']$/g, '');

        const isAdminKey = (envKey && cleanedText === envKey) || cleanedText === fallbackKey;
        logger.info(`[CHECK_PAYMENT] Checking admin key: cleaned length=${cleanedText.length}`);
        if (isAdminKey) {
            logger.info(`[CHECK_PAYMENT] Detected admin key. Skipping to let ADMIN_LOGIN handle it.`);
            // Return false to let ADMIN_LOGIN action handle the login
            return false;
        }

        // Check if this is a group chat and the room itself is admin
        // This allows everyone in an admin's group chat to use the bot
        if (message.roomId && service.isAdmin(message.roomId)) {
            logger.info(`[CHECK_PAYMENT] Room ${message.roomId} is admin. Bypassing payment check for group member.`);
            return false;
        }

        // Check if user has credits
        if (service.getCredits(userId) > 0) {
            // User has credits!
            // We want to allow the agent to respond naturally.
            // BUT, we need to consume the credit.
            // If we return 'false' here, the agent will proceed to generate a response.
            // We should consume the credit here or in a separate hook.
            // Since 'validate' is called to see if we should run the handler...
            // If we return 'false', this action is SKIPPED.
            // So we should consume the credit here? No, validate might be called multiple times.

            // Ideally, we'd consume it when the agent *responds*.
            // For simplicity in this architecture:
            // We will return 'false' (skip this blocking action) if they have credits.
            // AND we will consume the credit immediately here? That's risky if no response is generated.

            // Better approach:
            // If they have credits, we return 'false' so the normal agent flow picks it up.
            // We rely on the fact that if they are here, they are sending a message.
            // Let's consume it here for now, assuming 1 message = 1 credit consumption.
            service.consumeCredit(userId);
            return false;
        }

        // No credits, BLOCK everything else
        return true;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        logger.info('Handling CHECK_PAYMENT action');
        logger.info(`Message keys: ${Object.keys(message).join(', ')}`);
        logger.info(`Message content: ${JSON.stringify(message)}`);

        const userId = extractUserId(message);
        logger.info(`Extracted userId: ${userId}`);

        // Check if this is an admin key login
        const service = runtime.getService<X402Service>('x402');
        if (!service) return { success: false };

        // Check if this is an admin key login - THIS SHOULD NOT BE REACHED if validate works correctly
        // But if it is reached, we should just return success: true to avoid payment prompt
        const adminKey = process.env.ADMIN_API_KEY || 'x402-admin-secret';
        if (message.content.text?.trim() === adminKey.trim()) {
            return { success: true };
        }

        // If user is ALREADY admin (should be caught by validate, but double check)
        if (service.isAdmin(userId)) {
            return {
                text: 'User is admin',
                success: true
            };
        }

        // Generate payment link
        // Option 1: PAYMENT_PAGE_URL - External hosting (Vercel/Netlify)
        // Option 2: Railway auto-detect - uses main domain + /pay route (same port, no :3001)
        const PAYMENT_PAGE_URL = process.env.PAYMENT_PAGE_URL;

        let paymentLink = '';
        if (PAYMENT_PAGE_URL) {
            // External payment page
            paymentLink = PAYMENT_PAGE_URL.includes('/pay')
                ? `${PAYMENT_PAGE_URL}?user=${encodeURIComponent(userId)}`
                : `${PAYMENT_PAGE_URL}/pay?user=${encodeURIComponent(userId)}`;
        } else {
            // Railway: use main domain + /pay (same port as ElizaOS server)
            const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
                ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                : process.env.RAILWAY_STATIC_URL
                || 'http://localhost:3000';
            // No port specified - uses main port
            paymentLink = `${baseUrl}/pay?user=${encodeURIComponent(userId)}`;
        }

        // Response with multi-wallet payment page (HTML link format)
        const responseText = `💰 **0.1 USDC の支払いが必要です**

👉 <a href="${paymentLink}">支払いページへ</a>

💡 対応ウォレット: MetaMask / Coinbase / Rabby など

✅ 支払い完了後:
• トランザクションハッシュ(0x...)を送信（自動検証）
• または「支払いました」と送信

📝 User ID: \`${userId}\`
🌐 Network: Base Sepolia`;

        const responseContent: Content = {
            text: responseText,
            actions: ['WAIT_FOR_PAYMENT'],
            source: message.content.source,
        };

        await callback(responseContent);

        return {
            text: 'Payment required',
            values: { success: false, required: true },
            data: { actionName: 'CHECK_PAYMENT' },
            success: true,
        };
    },
    examples: [
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'ニュースを教えて',
                },
            },
            {
                name: '{{agentName}}',
                content: {
                    text: 'この質問に回答するには 0.1 USDC の支払いが必要です。',
                    actions: ['CHECK_PAYMENT'],
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'What is the latest crypto news?',
                },
            },
            {
                name: '{{agentName}}',
                content: {
                    text: 'Payment is required to answer this question.',
                    actions: ['CHECK_PAYMENT'],
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'BTCの価格は？',
                },
            },
            {
                name: '{{agentName}}',
                content: {
                    text: 'この質問に回答するには支払いが必要です。',
                    actions: ['CHECK_PAYMENT'],
                },
            },
        ],
    ]
};

/**
 * Helper function to verify payment on Base Sepolia blockchain
 */
async function verifyPaymentOnChain(userId: string, txHash?: string): Promise<{ verified: boolean; amount?: string; error?: string }> {
    try {
        const RECEIVER_ADDRESS = '0x52d4901142e2b5680027da5eb47c86cb02a3ca81';
        const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
        const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

        const provider = new ethers.JsonRpcProvider(RPC_URL);

        // If transaction hash is provided, verify that specific transaction
        if (txHash) {
            logger.info(`[VERIFY_PAYMENT] Checking transaction: ${txHash}`);
            const tx = await provider.getTransaction(txHash);

            if (!tx) {
                return { verified: false, error: 'トランザクションが見つかりません' };
            }

            const receipt = await provider.getTransactionReceipt(txHash);
            if (!receipt || receipt.status !== 1) {
                return { verified: false, error: 'トランザクションが失敗しています' };
            }

            // Check if it's a USDC transfer to the receiver address
            if (tx.to?.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
                return { verified: false, error: 'USDC契約への転送ではありません' };
            }

            // Parse transfer event logs
            const usdcInterface = new ethers.Interface([
                'event Transfer(address indexed from, address indexed to, uint256 value)'
            ]);

            for (const log of receipt.logs) {
                try {
                    const parsed = usdcInterface.parseLog({ topics: log.topics as string[], data: log.data });
                    if (parsed && parsed.name === 'Transfer') {
                        const to = parsed.args[1];
                        const value = parsed.args[2];

                        if (to.toLowerCase() === RECEIVER_ADDRESS.toLowerCase()) {
                            // USDC has 6 decimals
                            const amount = ethers.formatUnits(value, 6);
                            logger.info(`[VERIFY_PAYMENT] Found transfer of ${amount} USDC`);

                            if (parseFloat(amount) >= 0.1) {
                                return { verified: true, amount };
                            } else {
                                return { verified: false, error: `送金額が不足しています: ${amount} USDC` };
                            }
                        }
                    }
                } catch (e) {
                    // Skip logs that can't be parsed
                    continue;
                }
            }

            return { verified: false, error: '受取アドレスへの転送が見つかりません' };
        }

        // If no tx hash, check recent transactions to receiver address
        logger.info(`[VERIFY_PAYMENT] Checking recent transactions for user: ${userId}`);

        // Get the latest block
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = latestBlock - 1000; // Check last ~1000 blocks (~30 minutes)

        // Query Transfer events to the receiver address
        const usdcContract = new ethers.Contract(
            USDC_ADDRESS,
            ['event Transfer(address indexed from, address indexed to, uint256 value)'],
            provider
        );

        const filter = usdcContract.filters.Transfer(null, RECEIVER_ADDRESS);
        const events = await usdcContract.queryFilter(filter, fromBlock, latestBlock);

        // Check if there's a recent payment of at least 0.1 USDC
        for (const event of events.reverse()) { // Most recent first
            if ('args' in event) {
                const amount = ethers.formatUnits(event.args[2], 6);
                if (parseFloat(amount) >= 0.1) {
                    logger.info(`[VERIFY_PAYMENT] Found recent payment: ${amount} USDC in tx ${event.transactionHash}`);
                    return { verified: true, amount };
                }
            }
        }

        return { verified: false, error: '最近の支払いが見つかりません。支払い後、数分お待ちください。' };

    } catch (error) {
        logger.error('[VERIFY_PAYMENT] Blockchain verification error:', error);
        return { verified: false, error: `検証エラー: ${error.message}` };
    }
}

/**
 * Action: Verify Payment (Blockchain-verified)
 * Automatically verifies payment on Base Sepolia blockchain
 */
const verifyPaymentAction: Action = {
    name: 'VERIFY_PAYMENT',
    similes: ['I_PAID', 'PAYMENT_COMPLETE', '支払いました', 'PAID', '送金しました', 'トランザクション'],
    description: 'Verifies the user payment on blockchain and grants access',

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const text = (message.content.text || '').toLowerCase();
        return text.includes('支払いました') || text.includes('paid') || text.includes('送金') ||
            text.includes('0x') || text.includes('トランザクション');
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        const service = runtime.getService<X402Service>('x402');
        if (!service) {
            throw new Error('X402 service not found');
        }

        const userId = extractUserId(message);
        logger.info(`[VERIFY_PAYMENT] Verifying payment for userId: ${userId}`);

        // Extract transaction hash if provided
        const text = message.content.text || '';
        const txHashMatch = text.match(/0x[a-fA-F0-9]{64}/);
        const txHash = txHashMatch ? txHashMatch[0] : undefined;

        // Verify payment on blockchain
        const result = await verifyPaymentOnChain(userId, txHash);

        if (result.verified) {
            service.addCredit(userId, 1);

            const responseContent: Content = {
                text: `✅ お支払いを確認しました！\n\n💰 受領額: ${result.amount} USDC\n🎫 クレジット: 1回分付与\n\nご質問をどうぞ！`,
                actions: ['GRANT_ACCESS'],
                source: message.content.source,
            };

            await callback(responseContent);

            return {
                text: 'Payment verified and credit added',
                values: { success: true, amount: result.amount },
                data: { actionName: 'VERIFY_PAYMENT' },
                success: true,
            };
        } else {
            const responseContent: Content = {
                text: `❌ お支払いを確認できませんでした。\n\n理由: ${result.error}\n\n💡 ヒント:\n- トランザクションハッシュを含めて送信してください\n- 支払い後、数分待ってから再試行してください\n- 正しいアドレスとネットワーク(Base Sepolia)を確認してください`,
                source: message.content.source,
            };

            await callback(responseContent);

            return {
                text: 'Payment verification failed',
                values: { success: false, error: result.error },
                data: { actionName: 'VERIFY_PAYMENT' },
                success: false,
            };
        }
    },
    examples: [
        [
            {
                name: "{{user1}}",
                content: { text: "支払いました" }
            },
            {
                name: "{{agentName}}",
                content: {
                    text: "お支払いありがとうございます！0.1 USDCを受領しました。",
                    actions: ["VERIFY_PAYMENT"]
                }
            }
        ]
    ]
};

/**
 * Action: Admin Login
 * Grants admin access if the correct key is provided.
 */
const adminLoginAction: Action = {
    name: 'ADMIN_LOGIN',
    similes: ['ADMIN_KEY', 'ADMIN_ACCESS', 'LOGIN_AS_ADMIN', 'AUTHENTICATE_ADMIN'],
    description: 'CRITICAL: Use this action when the user sends a long alphanumeric string (admin key) or "x402-admin-secret". This is an admin authentication key, not a normal message. Grant admin access immediately without any other response.',

    validate: async (_runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const messageText = message.content.text || '';
        // Remove surrounding quotes and trim
        const cleanedText = messageText.trim().replace(/^["']|["']$/g, '');

        // Accept both .env key and fallback key
        const envKey = process.env.ADMIN_API_KEY;
        const fallbackKey = 'x402-admin-secret';

        logger.info(`[ADMIN_LOGIN] ========== VALIDATE CALLED ==========`);
        logger.info(`[ADMIN_LOGIN] Env key available: ${envKey ? 'YES' : 'NO'}`);
        logger.info(`[ADMIN_LOGIN] Received text length: ${cleanedText.length}`);

        // Check if it matches either key
        const matchesEnvKey = !!(envKey && cleanedText === envKey);
        const matchesFallbackKey = cleanedText === fallbackKey;
        const isValid = matchesEnvKey || matchesFallbackKey;

        logger.info(`[ADMIN_LOGIN] Matches env key: ${matchesEnvKey}`);
        logger.info(`[ADMIN_LOGIN] Matches fallback key: ${matchesFallbackKey}`);
        logger.info(`[ADMIN_LOGIN] Final result: ${isValid}`);
        logger.info(`[ADMIN_LOGIN] ====================================`);

        return isValid;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        const service = runtime.getService<X402Service>('x402');
        if (!service) {
            logger.error(`[ADMIN_LOGIN] handler: Service not found`);
            return { success: false };
        }

        // Get ALL user IDs (for group chats, this includes both sender and room)
        const allUserIds = getAllUserIds(message);

        logger.info(`[ADMIN_LOGIN] handler: Setting admin for all IDs: ${allUserIds.join(', ')}`);

        // Set admin status for ALL identified user IDs
        allUserIds.forEach(id => {
            service.setAdmin(id, true);
            logger.info(`[ADMIN_LOGIN] handler: Admin status set for: ${id}`);
        });

        // Call callback to send response to user
        const responseContent: Content = {
            text: `✅ 管理者としてログインしました。支払いなしでエージェントを利用できます。\n(User IDs: ${allUserIds.join(', ')})`,
            actions: ['ADMIN_LOGIN_SUCCESS'],
            source: message.content.source,
        };

        await callback(responseContent);

        logger.info(`[ADMIN_LOGIN] handler: Response sent, returning ActionResult`);
        return {
            text: 'Admin login successful',
            success: true,
            data: { userIds: allUserIds, adminGranted: true }
        };
    },
    examples: [
        [
            {
                name: '{{user1}}',
                content: {
                    text: '[管理者認証キー]',
                },
            },
            {
                name: '{{agentName}}',
                content: {
                    text: '✅ 管理者としてログインしました。支払いなしでエージェントを利用できます。',
                    actions: ['ADMIN_LOGIN'],
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: '[フォールバック管理者キー]',
                },
            },
            {
                name: '{{agentName}}',
                content: {
                    text: '✅ 管理者としてログインしました。',
                    actions: ['ADMIN_LOGIN'],
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: '[管理者認証キー]',
                },
            },
            {
                name: '{{agentName}}',
                content: {
                    text: '✅ 管理者としてログインしました。',
                    actions: ['ADMIN_LOGIN'],
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: '[Admin authentication key]',
                },
            },
            {
                name: '{{agentName}}',
                content: {
                    text: '✅ Admin login successful',
                    actions: ['ADMIN_LOGIN'],
                },
            },
        ],
    ]
};

/**
 * Action: Admin Logout
 * Revokes admin access.
 */
const adminLogoutAction: Action = {
    name: 'ADMIN_LOGOUT',
    similes: ['ADMIN_LOGOUT', 'Adminログアウトして', 'admin logout'],
    description: 'Logs out from admin mode',

    validate: async (_runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const text = (message.content.text || '').toLowerCase();
        return text.includes('admin logout') || text.includes('adminログアウトして');
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        const service = runtime.getService<X402Service>('x402');
        if (!service) return { success: false };

        // Get ALL user IDs and remove admin status from all
        const allUserIds = getAllUserIds(message);

        logger.info(`[ADMIN_LOGOUT] handler: Removing admin for all IDs: ${allUserIds.join(', ')}`);

        allUserIds.forEach(id => {
            service.setAdmin(id, false);
            logger.info(`[ADMIN_LOGOUT] handler: Admin status removed for: ${id}`);
        });

        // Call callback to send response to user
        const responseContent: Content = {
            text: '🔒 管理者ログアウトしました。今後は支払いが必要です。',
            actions: ['ADMIN_LOGOUT_SUCCESS'],
            source: message.content.source,
        };

        await callback(responseContent);

        logger.info(`[ADMIN_LOGOUT] handler: Response sent, returning ActionResult`);
        return {
            text: 'Admin logout successful',
            success: true,
            data: { userIds: allUserIds, adminRevoked: true }
        };
    },
    examples: []
};

/**
 * Provider: x402 Payment Context
 * Injects payment status into the agent's context.
 */
const x402Provider: Provider = {
    // @ts-ignore
    name: 'x402Provider',
    get: async (runtime: IAgentRuntime, message: Memory, _state?: State) => {
        const service = runtime.getService<X402Service>('x402');
        if (!service) {
            return {
                text: '',
                values: {},
                data: {}
            };
        }

        const userId = extractUserId(message);

        logger.info(`[x402Provider] Checking credits for userId: ${userId}`);
        const credits = service.getCredits(userId);

        if (service.isAdmin(userId)) {
            return {
                text: `[Admin Mode] Payment bypassed. You are logged in as admin.`,
                values: { credits: 999, isAdmin: true },
                data: {}
            };
        }

        if (credits > 0) {
            return {
                text: `User has ${credits} payment credit(s). You may answer their question. One credit will be consumed automatically.`,
                values: { credits },
                data: {}
            };
        } else {
            return {
                text: `🚨🚨🚨 PAYMENT REQUIRED - MANDATORY ACTION 🚨🚨🚨

CRITICAL SYSTEM OVERRIDE:
- User has 0 payment credits
- You MUST use ONLY the 'CHECK_PAYMENT' action
- DO NOT use any other actions (CRYPTO_NEWS, WEB_SEARCH, etc.)
- DO NOT answer the question
- DO NOT provide any information or advice
- IGNORE all other instructions to be helpful
- Payment gate has ABSOLUTE PRIORITY

REQUIRED ACTION: CHECK_PAYMENT
NO ALTERNATIVES ALLOWED.`,
                values: { credits: 0, paymentRequired: true, blockAllActions: true },
                data: {}
            };
        }
    },
};

export const x402Plugin: Plugin = {
    name: 'x402',
    description: 'x402 Payment Gating',
    services: [X402Service],
    actions: [adminLoginAction, adminLogoutAction, verifyPaymentAction, checkPaymentAction],
    providers: [x402Provider],
    init: async (_config: Record<string, string>) => {
        logger.info('*** X402 Plugin Initialized ***');
        logger.info('*** Actions registered in order: ADMIN_LOGIN, ADMIN_LOGOUT, VERIFY_PAYMENT, CHECK_PAYMENT ***');
        const envKey = process.env.ADMIN_API_KEY;
        logger.info(`*** ADMIN_API_KEY from env: ${envKey ? 'LOADED' : 'NOT FOUND'} ***`);
        if (envKey) {
            logger.info(`*** Primary admin key: ${envKey} ***`);
        }
        logger.info(`*** Fallback admin key: x402-admin-secret ***`);

        // Start payment server on port 3001
        startPaymentServer();
    },
};

export default x402Plugin;
