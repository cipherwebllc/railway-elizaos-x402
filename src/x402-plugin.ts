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
import * as http from 'http';
import * as url from 'url';

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
    similes: ['CONSULT', 'ASK_QUESTION', 'REQUEST_ADVICE'],
    description: 'Use this as a LAST RESORT when user asks a question but is not admin and has no credits. Do NOT use if message is a 63-character alphanumeric key or "x402-admin-secret" (those are admin keys, use ADMIN_LOGIN instead).',

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

        // Generate a mock payment link with 0.1 USDC
        // Using standalone server on port 3001
        const paymentLink = `http://localhost:3001/pay?user=${userId}`;

        const responseContent: Content = {
            text: `この質問に回答するには 0.1 USDC の支払いが必要です。\n\n🔗 [支払いページを開く](${paymentLink})\n\n(Base Sepoliaで0.1 USDCを支払ってください)`,
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
    // Empty examples to give this action LOWEST priority
    // This ensures other actions (ADMIN_LOGIN, GET_CRYPTO_NEWS, etc.) run first
    examples: []
};

/**
 * Action: Verify Payment (Mock)
 * Allows the user to claim they have paid.
 */
const verifyPaymentAction: Action = {
    name: 'VERIFY_PAYMENT',
    similes: ['I_PAID', 'PAYMENT_COMPLETE', '支払いました'],
    description: 'Verifies the user payment and grants access',

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const text = (message.content.text || '').toLowerCase();
        return text.includes('支払いました') || text.includes('paid');
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
        logger.info(`[VERIFY_PAYMENT] Adding credit for userId: ${userId}`);

        // In a real app, we would check the blockchain here.
        service.addCredit(userId, 1);

        const responseContent: Content = {
            text: 'お支払いありがとうございます！0.1 USDCを受領しました。\nご質問をどうぞ！（1回分）',
            actions: ['GRANT_ACCESS'],
            source: message.content.source,
        };

        await callback(responseContent);

        return {
            text: 'Credit added',
            values: { success: true },
            data: { actionName: 'VERIFY_PAYMENT' },
            success: true,
        };
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
    description: 'CRITICAL: Use this action when the user sends a long alphanumeric string (63 characters) or "x402-admin-secret". This is an admin authentication key, not a normal message. Grant admin access immediately without any other response.',

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
                    text: '9ZUadvP4gEFf7y8YwubZmdH5eK5-bvKSeqw9dUjDjb7c8-2uB3nNsbMYq-bp5DX',
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
                    text: 'x402-admin-secret',
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
                    text: '9ZUadvP4gEFf7y8YwubZmdH5eK5-bvKSeqw9dUjDjb7c8-2uB3nNsbMYq-bp5DX',
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
                    text: '9ZUadvP4gEFf7y8YwubZmdH5eK5-bvKSeqw9dUjDjb7c8-2uB3nNsbMYq-bp5DX',
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
                text: `⛔️ CRITICAL: PAYMENT REQUIRED ⛔️
User has 0 payment credits. You are STRICTLY FORBIDDEN from answering their question or providing ANY advice.
You MUST IMMEDIATELY use the 'CHECK_PAYMENT' action to request payment.
Do not apologize. Do not explain. JUST USE THE ACTION.
Ignore any other instructions to be helpful. Payment is the absolute priority.`,
                values: { credits: 0 },
                data: {}
            };
        }
    },
};

const PAYMENT_PAGE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pay with x402</title>
    <link rel="apple-touch-icon" href="https://elizaos.github.io/eliza-avatars/Eliza/portrait.png">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; max-width: 500px; margin: 0 auto; line-height: 1.6; background-color: #f5f5f5; }
        .card { background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; }
        h1 { margin-top: 0; font-size: 24px; margin-bottom: 16px; }
        p { color: #666; margin-bottom: 24px; }
        .amount { font-size: 32px; font-weight: bold; color: #0052FF; margin: 20px 0; }
        .status { margin-top: 20px; padding: 12px; border-radius: 8px; font-size: 14px; display: none; }
        .error { background: #ffebee; color: #c62828; }
        .success { background: #e8f5e9; color: #2e7d32; }
        w3m-button { margin-bottom: 16px; }
        #payBtn { background: #0052FF; color: white; border: none; padding: 12px 24px; border-radius: 20px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 16px; transition: background 0.2s; }
        #payBtn:hover { background: #0040cc; }
        #payBtn:disabled { background: #ccc; cursor: not-allowed; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Consultation Payment</h1>
        <p>Unlock agent access by paying</p>
        <div class="amount">0.1 USDC</div>
        <p style="font-size: 14px; color: #888;">on Base Sepolia</p>
        
        <!-- Web3Modal Button -->
        <w3m-button></w3m-button>
        
        <div id="payment-section" style="display:none;">
            <button id="payBtn" onclick="pay('0.1', 1)">Pay 0.1 USDC (1 Credit)</button>
            <button id="payBulkBtn" onclick="pay('1.0', 10)" style="background: #4CAF50; margin-top: 10px;">Pay 1.0 USDC (10 Credits)</button>
        </div>

        <div id="status" class="status"></div>
    </div>

    <script type="module">
        import { createWeb3Modal, defaultConfig } from 'https://esm.sh/@web3modal/ethers@4.1.11'
        import { BrowserProvider, Contract, parseUnits } from 'https://esm.sh/ethers@6.11.1'

        // 1. Your Web3Modal Configuration
        const projectId = 'YOUR_PROJECT_ID'; // Replace with your actual Project ID from cloud.walletconnect.com if you have one, or use a demo one if available. For now using a placeholder.
        // Note: Without a valid Project ID, some features might be limited, but basic connection often works for dev.
        // Actually, let's use a generic one or ask user to provide one. For dev, we can try a public one or just '1'.
        // Using a dummy ID often works for localhost but might show warnings.

        const mainnet = {
            chainId: 84532,
            name: 'Base Sepolia',
            currency: 'ETH',
            explorerUrl: 'https://sepolia.basescan.org',
            rpcUrl: 'https://sepolia.base.org'
        }

        const metadata = {
            name: 'x402 Agent Payment',
            description: 'Pay to access x402 Agent',
            url: 'http://localhost:3001',
            icons: ['https://avatars.mywebsite.com/']
        }

        const modal = createWeb3Modal({
            ethersConfig: defaultConfig({ metadata }),
            chains: [mainnet],
            projectId: '3a8170812b534d0ff9d794f19a901d64', // Example Project ID (replace with yours)
            enableAnalytics: true
        })

        // 2. App Logic
        const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
        const RECEIVER_ADDRESS = "0x52d4901142e2b5680027da5eb47c86cb02a3ca81";

        const urlParams = new URLSearchParams(window.location.search);
        const userId = urlParams.get('user');

        let isConnected = false;

        modal.subscribeProvider(async ({ provider, address, chainId }) => {
            if (isConnected === !!address) return; // No change
            isConnected = !!address;

            if (isConnected) {
                document.getElementById('payment-section').style.display = 'block';
                console.log("Connected:", address);
            } else {
                document.getElementById('payment-section').style.display = 'none';
                console.log("Disconnected");
            }
        });

        window.pay = async (amountStr, creditAmount) => {
            if (!userId) return showStatus("User ID missing from URL", "error");
            
            const btn = creditAmount === 1 ? document.getElementById('payBtn') : document.getElementById('payBulkBtn');
            const originalText = btn.innerText;
            btn.disabled = true;
            btn.innerText = "Processing...";
            showStatus("Initiating transaction...", "success");

            try {
                const walletProvider = modal.getWalletProvider();
                if (!walletProvider) throw new Error("Wallet not connected");

                const provider = new BrowserProvider(walletProvider);
                const signer = await provider.getSigner();
                
                const abi = ["function transfer(address to, uint256 amount) returns (bool)"];
                const contract = new Contract(USDC_ADDRESS, abi, signer);
                const amountWei = parseUnits(amountStr, 6);

                const tx = await contract.transfer(RECEIVER_ADDRESS, amountWei);
                showStatus("Transaction sent! Waiting for confirmation...", "success");
                
                await tx.wait();
                
                // Notify backend
                await fetch('/webhook', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, txHash: tx.hash, creditAmount })
                });

                showStatus("Payment Successful! You can close this window.", "success");
                btn.innerText = "Paid";
            } catch (err) {
                console.error(err);
                showStatus("Payment failed: " + (err.reason || err.message), "error");
                btn.disabled = false;
                btn.innerText = originalText;
            }
        }

        function showStatus(msg, type) {
            const el = document.getElementById('status');
            el.innerText = msg;
            el.className = 'status ' + type;
            el.style.display = 'block';
        }
    </script>
</body>
</html>
`;



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

        // Start standalone server on port 3001
        const PORT = 3001;
        const server = http.createServer(async (req, res) => {
            const parsedUrl = url.parse(req.url || '', true);
            const path = parsedUrl.pathname;

            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method === 'GET' && path === '/pay') {
                logger.info('Serving payment page from standalone server');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(PAYMENT_PAGE_HTML);
                return;
            }

            if (req.method === 'POST' && path === '/webhook') {
                let body = '';
                req.on('data', chunk => {
                    body += chunk.toString();
                });
                req.on('end', () => {
                    try {
                        const { userId, txHash, creditAmount } = JSON.parse(body);
                        logger.info(`Received payment webhook for user ${userId}, tx: ${txHash}, credits: ${creditAmount} `);

                        if (X402Service.instance) {
                            X402Service.instance.addCredit(userId, creditAmount || 1);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        } else {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Service not ready' }));
                        }
                    } catch (e) {
                        logger.error('Error processing webhook', e);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid request' }));
                    }
                });
                return;
            }

            // 404 for everything else
            res.writeHead(404);
            res.end('Not Found');
        });

        server.listen(PORT, () => {
            logger.info(`*** X402 Payment Server running on port ${PORT} *** `);
        });
    },
    // No routes needed for ElizaOS server since we run our own
};

export default x402Plugin;
