import type { Plugin } from '@elizaos/core';
import {
    type Action,
    type ActionResult,
    type Content,
    type Evaluator,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type Provider,
    Service,
    type State,
    logger,
} from '@elizaos/core';
import { ethers } from 'ethers';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';

// ============================================
// Configuration
// ============================================
const CONFIG = {
    FREE_DAILY_LIMIT: 3,
    DAILY_QUERY_LIMIT: 30,
    PRO_DURATION_DAYS: 30,

    // Base Mainnet USDC pricing
    SINGLE_PRICE_USDC: 0.1,
    DAILY_PRICE_USDC: 1,
    PRO_PRICE_USDC: 9,
    USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base Mainnet USDC (6 decimals)
    BASE_RPC_URL: process.env.BASE_RPC_URL || 'https://mainnet.base.org',

    // Polygon JPYC pricing
    SINGLE_PRICE_JPYC: 15,
    DAILY_PRICE_JPYC: 150,
    PRO_PRICE_JPYC: 1500,
    JPYC_ADDRESS: '0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB', // Polygon JPYC v2 (18 decimals)
    POLYGON_RPC_URL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',

    // Common
    RECEIVER_ADDRESS: process.env.X402_RECEIVER_ADDRESS || '',
    DB_DIR: process.env.X402_DB_DIR || './data',
};

/**
 * Check if the provided text matches the admin API key
 * Only uses environment variable - no hard-coded fallback for security
 */
function isAdminKey(text: string): boolean {
    const envKey = process.env.ADMIN_API_KEY;
    if (!envKey) {
        logger.warn('[x402] ADMIN_API_KEY not set - admin features disabled');
        return false;
    }
    const cleanedText = text.trim().replace(/^["']|["']$/g, '');
    return cleanedText === envKey;
}

// ============================================
// SQLite Database Manager (using sql.js - pure JS, no native bindings)
// ============================================
class X402Database {
    private db: SqlJsDatabase | null = null;
    private dbPath: string;
    private static instance: X402Database | null = null;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;

    constructor() {
        // Ensure data directory exists
        if (!fs.existsSync(CONFIG.DB_DIR)) {
            fs.mkdirSync(CONFIG.DB_DIR, { recursive: true });
        }
        this.dbPath = path.join(CONFIG.DB_DIR, 'x402.db');
    }

    static getInstance(): X402Database {
        if (!X402Database.instance) {
            X402Database.instance = new X402Database();
        }
        return X402Database.instance;
    }

    async init(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._init();
        await this.initPromise;
    }

    private async _init(): Promise<void> {
        try {
            const SQL = await initSqlJs();

            // Try to load existing database
            if (fs.existsSync(this.dbPath)) {
                const buffer = fs.readFileSync(this.dbPath);
                this.db = new SQL.Database(buffer);
                logger.info(`[X402DB] Loaded existing database from: ${this.dbPath}`);
            } else {
                this.db = new SQL.Database();
                logger.info(`[X402DB] Created new database`);
            }

            this.initSchema();
            this.save();
            this.initialized = true;
            logger.info(`[X402DB] Database initialized at: ${this.dbPath}`);
        } catch (error) {
            logger.error({ error }, '[X402DB] Failed to initialize database');
            throw error;
        }
    }

    private initSchema() {
        if (!this.db) return;

        this.db.run(`
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                is_admin INTEGER DEFAULT 0,
                is_pro INTEGER DEFAULT 0,
                pro_expires_at TEXT,
                is_daily INTEGER DEFAULT 0,
                daily_plan_expires_at TEXT,
                daily_plan_used INTEGER DEFAULT 0,
                credits INTEGER DEFAULT 0,
                daily_free_used INTEGER DEFAULT 0,
                daily_reset_date TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add new columns if they don't exist (for migration)
        try {
            this.db.run(`ALTER TABLE users ADD COLUMN is_daily INTEGER DEFAULT 0`);
        } catch (e) { /* Column might already exist */ }
        try {
            this.db.run(`ALTER TABLE users ADD COLUMN daily_plan_expires_at TEXT`);
        } catch (e) { /* Column might already exist */ }
        try {
            this.db.run(`ALTER TABLE users ADD COLUMN daily_plan_used INTEGER DEFAULT 0`);
        } catch (e) { /* Column might already exist */ }

        this.db.run(`
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tx_hash TEXT UNIQUE,
                user_id TEXT,
                amount REAL,
                payment_type TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes (ignore if exists)
        try {
            this.db.run(`CREATE INDEX idx_payments_user ON payments(user_id)`);
        } catch (e) { /* Index might already exist */ }
        try {
            this.db.run(`CREATE INDEX idx_payments_tx ON payments(tx_hash)`);
        } catch (e) { /* Index might already exist */ }
    }

    private save() {
        if (!this.db) return;
        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
        } catch (error) {
            logger.error({ error }, '[X402DB] Failed to save database');
        }
    }

    // User Management
    getUser(userId: string): any {
        if (!this.db) return null;
        const stmt = this.db.prepare('SELECT * FROM users WHERE user_id = ?');
        stmt.bind([userId]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null;
    }

    ensureUser(userId: string): any {
        let user = this.getUser(userId);
        if (!user) {
            if (!this.db) return null;
            const today = new Date().toISOString().split('T')[0];
            this.db.run(
                `INSERT INTO users (user_id, daily_reset_date) VALUES (?, ?)`,
                [userId, today]
            );
            this.save();
            user = this.getUser(userId);
        }
        return user;
    }

    // Free Tier Management
    checkAndResetDailyFree(userId: string): void {
        const user = this.ensureUser(userId);
        if (!user || !this.db) return;
        const today = new Date().toISOString().split('T')[0];

        if (user.daily_reset_date !== today) {
            this.db.run(
                `UPDATE users SET daily_free_used = 0, daily_reset_date = ?, updated_at = datetime('now') WHERE user_id = ?`,
                [today, userId]
            );
            this.save();
        }
    }

    getDailyFreeRemaining(userId: string): number {
        this.checkAndResetDailyFree(userId);
        const user = this.getUser(userId);
        return Math.max(0, CONFIG.FREE_DAILY_LIMIT - (user?.daily_free_used || 0));
    }

    consumeDailyFree(userId: string): boolean {
        this.checkAndResetDailyFree(userId);
        const remaining = this.getDailyFreeRemaining(userId);
        if (remaining > 0 && this.db) {
            this.db.run(
                `UPDATE users SET daily_free_used = daily_free_used + 1, updated_at = datetime('now') WHERE user_id = ?`,
                [userId]
            );
            this.save();
            return true;
        }
        return false;
    }

    // Pro Management
    isPro(userId: string): boolean {
        const user = this.ensureUser(userId);
        if (!user?.is_pro) return false;

        const expiresAt = new Date(user.pro_expires_at);
        if (expiresAt < new Date()) {
            // Pro expired
            if (this.db) {
                this.db.run(
                    `UPDATE users SET is_pro = 0, updated_at = datetime('now') WHERE user_id = ?`,
                    [userId]
                );
                this.save();
            }
            return false;
        }
        return true;
    }

    getProExpiresAt(userId: string): Date | null {
        const user = this.getUser(userId);
        if (user?.pro_expires_at) {
            return new Date(user.pro_expires_at);
        }
        return null;
    }

    grantPro(userId: string, durationDays: number = CONFIG.PRO_DURATION_DAYS): void {
        this.ensureUser(userId);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + durationDays);

        if (this.db) {
            this.db.run(
                `UPDATE users SET is_pro = 1, pro_expires_at = ?, updated_at = datetime('now') WHERE user_id = ?`,
                [expiresAt.toISOString(), userId]
            );
            this.save();
            logger.info(`[X402DB] Pro granted to ${userId} until ${expiresAt.toISOString()}`);
        }
    }

    // Daily Plan Management (1 USDC / 30 queries per day)
    isDaily(userId: string): boolean {
        const user = this.ensureUser(userId);
        if (!user?.is_daily) return false;

        const expiresAt = new Date(user.daily_plan_expires_at);
        if (expiresAt < new Date()) {
            // Daily plan expired
            if (this.db) {
                this.db.run(
                    `UPDATE users SET is_daily = 0, daily_plan_used = 0, updated_at = datetime('now') WHERE user_id = ?`,
                    [userId]
                );
                this.save();
            }
            return false;
        }
        return true;
    }

    getDailyPlanRemaining(userId: string): number {
        if (!this.isDaily(userId)) return 0;
        const user = this.getUser(userId);
        return Math.max(0, CONFIG.DAILY_QUERY_LIMIT - (user?.daily_plan_used || 0));
    }

    getDailyPlanExpiresAt(userId: string): Date | null {
        const user = this.getUser(userId);
        if (user?.daily_plan_expires_at) {
            return new Date(user.daily_plan_expires_at);
        }
        return null;
    }

    grantDaily(userId: string): void {
        this.ensureUser(userId);
        // Daily plan expires at end of today (23:59:59)
        const expiresAt = new Date();
        expiresAt.setHours(23, 59, 59, 999);

        if (this.db) {
            this.db.run(
                `UPDATE users SET is_daily = 1, daily_plan_expires_at = ?, daily_plan_used = 0, updated_at = datetime('now') WHERE user_id = ?`,
                [expiresAt.toISOString(), userId]
            );
            this.save();
            logger.info(`[X402DB] Daily plan granted to ${userId} until ${expiresAt.toISOString()}`);
        }
    }

    consumeDaily(userId: string): boolean {
        if (!this.isDaily(userId)) return false;
        const remaining = this.getDailyPlanRemaining(userId);
        if (remaining > 0 && this.db) {
            this.db.run(
                `UPDATE users SET daily_plan_used = daily_plan_used + 1, updated_at = datetime('now') WHERE user_id = ?`,
                [userId]
            );
            this.save();
            return true;
        }
        return false;
    }

    // Admin Management
    isAdmin(userId: string): boolean {
        const user = this.getUser(userId);
        return user?.is_admin === 1;
    }

    setAdmin(userId: string, status: boolean): void {
        this.ensureUser(userId);
        if (this.db) {
            this.db.run(
                `UPDATE users SET is_admin = ?, updated_at = datetime('now') WHERE user_id = ?`,
                [status ? 1 : 0, userId]
            );
            this.save();
            logger.info(`[X402DB] Admin ${status ? 'granted' : 'revoked'} for ${userId}`);
        }
    }

    // Credit Management
    getCredits(userId: string): number {
        const user = this.ensureUser(userId);
        return user?.credits || 0;
    }

    addCredits(userId: string, amount: number): void {
        this.ensureUser(userId);
        if (this.db) {
            this.db.run(
                `UPDATE users SET credits = credits + ?, updated_at = datetime('now') WHERE user_id = ?`,
                [amount, userId]
            );
            this.save();
            logger.info(`[X402DB] Added ${amount} credits to ${userId}`);
        }
    }

    consumeCredit(userId: string): boolean {
        const credits = this.getCredits(userId);
        if (credits > 0 && this.db) {
            this.db.run(
                `UPDATE users SET credits = credits - 1, updated_at = datetime('now') WHERE user_id = ?`,
                [userId]
            );
            this.save();
            return true;
        }
        return false;
    }

    // Payment Tracking
    isPaymentUsed(txHash: string): boolean {
        if (!this.db) return false;
        const stmt = this.db.prepare('SELECT 1 FROM payments WHERE tx_hash = ?');
        stmt.bind([txHash]);
        const exists = stmt.step();
        stmt.free();
        return exists;
    }

    recordPayment(txHash: string, userId: string, amount: number, paymentType: string): void {
        if (this.db) {
            this.db.run(
                `INSERT INTO payments (tx_hash, user_id, amount, payment_type) VALUES (?, ?, ?, ?)`,
                [txHash, userId, amount, paymentType]
            );
            this.save();
            logger.info(`[X402DB] Payment recorded: ${txHash} for ${userId} (${amount} USDC, ${paymentType})`);
        }
    }

    // Status
    getUserStatus(userId: string): {
        isPro: boolean;
        proExpiresAt: Date | null;
        isDaily: boolean;
        dailyPlanRemaining: number;
        dailyPlanExpiresAt: Date | null;
        credits: number;
        dailyFreeRemaining: number;
        isAdmin: boolean;
    } {
        this.ensureUser(userId);
        return {
            isPro: this.isPro(userId),
            proExpiresAt: this.getProExpiresAt(userId),
            isDaily: this.isDaily(userId),
            dailyPlanRemaining: this.getDailyPlanRemaining(userId),
            dailyPlanExpiresAt: this.getDailyPlanExpiresAt(userId),
            credits: this.getCredits(userId),
            dailyFreeRemaining: this.getDailyFreeRemaining(userId),
            isAdmin: this.isAdmin(userId),
        };
    }
}

// ============================================
// Helper Functions
// ============================================
// Track processed messages to prevent multiple agents consuming access for same message
const processedMessages = new Map<string, {
    userId: string;
    hasAccess: boolean;
    consumed: boolean;
    timestamp: number;
}>();

// Configuration for message cache
const MESSAGE_CACHE_MAX_SIZE = 500;  // Max entries to prevent memory bloat
const MESSAGE_CACHE_TTL = 2 * 60 * 1000;  // 2 minutes (reduced from 5)
const MESSAGE_CACHE_CLEANUP_INTERVAL = 30 * 1000;  // 30 seconds (reduced from 60)

// Clean up old entries and enforce max size
setInterval(() => {
    const cutoff = Date.now() - MESSAGE_CACHE_TTL;
    let deleted = 0;

    for (const [key, value] of processedMessages.entries()) {
        if (value.timestamp < cutoff) {
            processedMessages.delete(key);
            deleted++;
        }
    }

    // If still over max size, remove oldest entries
    if (processedMessages.size > MESSAGE_CACHE_MAX_SIZE) {
        const entries = Array.from(processedMessages.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toRemove = entries.slice(0, processedMessages.size - MESSAGE_CACHE_MAX_SIZE);
        for (const [key] of toRemove) {
            processedMessages.delete(key);
            deleted++;
        }
    }

    if (deleted > 0) {
        logger.debug(`[X402] Cleaned up ${deleted} old message cache entries, size: ${processedMessages.size}`);
    }
}, MESSAGE_CACHE_CLEANUP_INTERVAL);

function extractUserId(message: Memory): string {
    // Log ALL possible user ID sources for debugging
    const sources = {
        userId: (message as any).userId,
        authorId: (message as any).authorId,
        author_id: (message as any).author_id,
        contentSourceId: (message.content as any)?.sourceId,
        metadataSourceId: (message.metadata as any)?.sourceId,
        rawSenderId: (message.metadata as any)?.raw?.senderId,
        roomId: message.roomId,
        entityId: (message as any).entityId,
        agentId: (message as any).agentId,
    };

    logger.debug(`[X402] extractUserId - All sources: ${JSON.stringify(sources)}`);

    // IMPORTANT: For web client (REST API), the userId field is actually the messageId
    // which changes every message. We need to use roomId as the persistent identifier.
    // Only use authorId/author_id if they look like actual user identifiers (not UUIDs that change)

    // For Telegram/Discord, use the actual sender ID from metadata
    const telegramSenderId = sources.rawSenderId;
    if (telegramSenderId && typeof telegramSenderId === 'number') {
        logger.debug(`[X402] extractUserId: Using Telegram senderId: ${telegramSenderId}`);
        return String(telegramSenderId);
    }

    // For platforms with stable author ID (not web client)
    const stableAuthorId = sources.authorId || sources.author_id;
    if (stableAuthorId && sources.roomId && stableAuthorId !== sources.roomId) {
        // Check if authorId is different from roomId - might be a real user ID
        // But for web client, authorId often equals messageId, so skip if it looks like a UUID
        const isUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!isUuidPattern.test(stableAuthorId)) {
            logger.debug(`[X402] extractUserId: Using stable authorId: ${stableAuthorId}`);
            return stableAuthorId;
        }
    }

    // For web client: use roomId as the persistent identifier
    // This represents the conversation/chat session
    if (sources.roomId) {
        logger.debug(`[X402] extractUserId: Using roomId as persistent identifier: ${sources.roomId}`);
        return sources.roomId;
    }

    // Fallback
    const fallback = sources.userId || sources.entityId || 'unknown';
    logger.debug(`[X402] extractUserId: Using fallback: ${fallback}`);
    return fallback;
}

function getMessageKey(message: Memory): string {
    const msgId = message.id || (message as any).messageId || '';
    const text = (message.content?.text || '').substring(0, 50);
    const roomId = message.roomId || '';
    return `${roomId}:${msgId}:${text}`;
}

function getAllUserIds(message: Memory): string[] {
    const ids: string[] = [];
    const directUserId = (message as any).userId ||
        (message as any).authorId ||
        (message as any).author_id ||
        (message.content as any)?.sourceId ||
        (message.metadata as any)?.sourceId ||
        (message.metadata as any)?.raw?.senderId;

    if (directUserId) ids.push(directUserId);
    if (message.roomId && message.roomId !== directUserId) ids.push(message.roomId);
    return ids;
}

// ============================================
// X402 Service
// ============================================
export class X402Service extends Service {
    static serviceType = 'x402';
    private db: X402Database;

    constructor(runtime: IAgentRuntime) {
        super(runtime);
        this.db = X402Database.getInstance();
    }

    static async start(runtime: IAgentRuntime) {
        if (!CONFIG.RECEIVER_ADDRESS) {
            throw new Error('X402_RECEIVER_ADDRESS env var is required — cannot start payment service without a receiver wallet');
        }
        logger.info('*** Starting X402 service (sql.js - pure JS, no native bindings) ***');
        const service = new X402Service(runtime);
        await service.db.init();
        return service;
    }

    static async stop(_runtime: IAgentRuntime) {
        logger.info('*** Stopping X402 service ***');
    }

    async stop() {
        logger.info('*** Stopping X402 service instance ***');
    }

    getDatabase(): X402Database {
        return this.db;
    }

    canAccess(userId: string): { allowed: boolean; reason: string; consumeType?: string } {
        if (this.db.isAdmin(userId)) {
            return { allowed: true, reason: 'admin' };
        }
        if (this.db.isPro(userId)) {
            return { allowed: true, reason: 'pro' };
        }
        // Daily plan: 1 USDC / 30 queries per day
        if (this.db.getDailyPlanRemaining(userId) > 0) {
            return { allowed: true, reason: 'daily', consumeType: 'daily' };
        }
        if (this.db.getCredits(userId) > 0) {
            return { allowed: true, reason: 'credit', consumeType: 'credit' };
        }
        if (this.db.getDailyFreeRemaining(userId) > 0) {
            return { allowed: true, reason: 'free', consumeType: 'free' };
        }
        return { allowed: false, reason: 'no_access' };
    }

    consumeAccess(userId: string, consumeType: string): void {
        if (consumeType === 'daily') {
            this.db.consumeDaily(userId);
        } else if (consumeType === 'credit') {
            this.db.consumeCredit(userId);
        } else if (consumeType === 'free') {
            this.db.consumeDailyFree(userId);
        }
    }
}

// ============================================
// Blockchain Verification (supports Base USDC and Polygon JPYC)
// ============================================
type PaymentVerificationResult = {
    verified: boolean;
    amount?: number;
    currency?: 'USDC' | 'JPYC';
    error?: string;
    isPro?: boolean;
    isDaily?: boolean;
};

// Verify payment on Base (USDC)
async function verifyUsdcPayment(txHash: string): Promise<PaymentVerificationResult> {
    try {
        const provider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC_URL);
        logger.info(`[VERIFY_USDC] Checking transaction on Base: ${txHash}`);
        const tx = await provider.getTransaction(txHash);

        if (!tx) {
            return { verified: false, error: 'Base上でトランザクションが見つかりません' };
        }

        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt || receipt.status !== 1) {
            return { verified: false, error: 'トランザクションが失敗しています' };
        }

        if (tx.to?.toLowerCase() !== CONFIG.USDC_ADDRESS.toLowerCase()) {
            return { verified: false, error: 'USDC契約への転送ではありません' };
        }

        const erc20Interface = new ethers.Interface([
            'event Transfer(address indexed from, address indexed to, uint256 value)'
        ]);

        for (const log of receipt.logs) {
            try {
                const parsed = erc20Interface.parseLog({ topics: log.topics as string[], data: log.data });
                if (parsed && parsed.name === 'Transfer') {
                    const to = parsed.args[1];
                    const value = parsed.args[2];

                    if (to.toLowerCase() === CONFIG.RECEIVER_ADDRESS.toLowerCase()) {
                        const amount = parseFloat(ethers.formatUnits(value, 6)); // USDC has 6 decimals
                        logger.info(`[VERIFY_USDC] Found transfer of ${amount} USDC`);
                        const isPro = amount >= CONFIG.PRO_PRICE_USDC;
                        const isDaily = !isPro && amount >= CONFIG.DAILY_PRICE_USDC;
                        return { verified: true, amount, currency: 'USDC', isPro, isDaily };
                    }
                }
            } catch (e) {
                continue;
            }
        }

        return { verified: false, error: '受取アドレスへのUSDC転送が見つかりません' };
    } catch (error: any) {
        logger.error({ error }, '[VERIFY_USDC] Error');
        return { verified: false, error: `Base検証エラー: ${error.message}` };
    }
}

// Verify payment on Polygon (JPYC)
async function verifyJpycPayment(txHash: string): Promise<PaymentVerificationResult> {
    try {
        const provider = new ethers.JsonRpcProvider(CONFIG.POLYGON_RPC_URL);
        logger.info(`[VERIFY_JPYC] Checking transaction on Polygon: ${txHash}`);
        const tx = await provider.getTransaction(txHash);

        if (!tx) {
            return { verified: false, error: 'Polygon上でトランザクションが見つかりません' };
        }

        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt || receipt.status !== 1) {
            return { verified: false, error: 'トランザクションが失敗しています' };
        }

        if (tx.to?.toLowerCase() !== CONFIG.JPYC_ADDRESS.toLowerCase()) {
            return { verified: false, error: 'JPYC契約への転送ではありません' };
        }

        const erc20Interface = new ethers.Interface([
            'event Transfer(address indexed from, address indexed to, uint256 value)'
        ]);

        for (const log of receipt.logs) {
            try {
                const parsed = erc20Interface.parseLog({ topics: log.topics as string[], data: log.data });
                if (parsed && parsed.name === 'Transfer') {
                    const to = parsed.args[1];
                    const value = parsed.args[2];

                    if (to.toLowerCase() === CONFIG.RECEIVER_ADDRESS.toLowerCase()) {
                        const amount = parseFloat(ethers.formatUnits(value, 18)); // JPYC has 18 decimals
                        logger.info(`[VERIFY_JPYC] Found transfer of ${amount} JPYC`);
                        const isPro = amount >= CONFIG.PRO_PRICE_JPYC;
                        const isDaily = !isPro && amount >= CONFIG.DAILY_PRICE_JPYC;
                        return { verified: true, amount, currency: 'JPYC', isPro, isDaily };
                    }
                }
            } catch (e) {
                continue;
            }
        }

        return { verified: false, error: '受取アドレスへのJPYC転送が見つかりません' };
    } catch (error: any) {
        logger.error({ error }, '[VERIFY_JPYC] Error');
        return { verified: false, error: `Polygon検証エラー: ${error.message}` };
    }
}

// Main verification function - tries both networks
async function verifyPaymentOnChain(txHash: string): Promise<PaymentVerificationResult> {
    logger.info(`[VERIFY_PAYMENT] Checking transaction: ${txHash}`);

    // Try Base (USDC) first
    const usdcResult = await verifyUsdcPayment(txHash);
    if (usdcResult.verified) {
        return usdcResult;
    }

    // Try Polygon (JPYC)
    const jpycResult = await verifyJpycPayment(txHash);
    if (jpycResult.verified) {
        return jpycResult;
    }

    // Neither worked - return combined error
    return {
        verified: false,
        error: 'トランザクションが見つかりません。Base(USDC)またはPolygon(JPYC)で送金してください。'
    };
}

// ============================================
// Actions
// ============================================

// Status Check Action
const statusAction: Action = {
    name: 'CHECK_STATUS',
    similes: ['ステータス', 'status', '残り回数', '利用状況', 'マイステータス', 'x402'],
    description: 'PRIORITY: Check user subscription status and remaining credits. Triggers on /status, x402, ステータス commands.',

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const text = (message.content.text || '').trim();
        const textLower = text.toLowerCase();
        const agentName = runtime.character?.name || 'unknown';

        // Dliza and Coo can respond to payment gate
        if (agentName !== 'Dliza' && agentName !== 'Coo') {
            return false;
        }

        // Strict matching for status commands
        const isStatusCommand =
            // Exact matches (single word)
            textLower === 'ステータス' ||
            textLower === 'status' ||
            textLower === 'x402' ||
            textLower === '/status' ||
            textLower === '/x402' ||
            // Contains specific phrases
            textLower.includes('残り回数') ||
            textLower.includes('利用状況') ||
            textLower.includes('x402 status') ||
            textLower.includes('x402 ステータス') ||
            // Starts with command prefix
            textLower.startsWith('/status') ||
            textLower.startsWith('x402 ');

        if (isStatusCommand) {
            logger.info(`[CHECK_STATUS:${agentName}] ✅ Matched status command: "${text}"`);
        }

        return isStatusCommand;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        try {
            const service = runtime.getService<X402Service>('x402');
            if (!service) return { success: false };

            const userId = extractUserId(message);
            const db = service.getDatabase();
            const status = db.getUserStatus(userId);

            let statusText = '📊 **あなたの利用状況**\n\n';

            if (status.isAdmin) {
                statusText += '👑 **管理者モード** - 無制限\n';
            } else if (status.isPro) {
                const expiresStr = status.proExpiresAt ? status.proExpiresAt.toLocaleDateString('ja-JP') : '';
                statusText += `⭐ **Pro会員** - 無制限（${expiresStr}まで）\n`;
            } else if (status.isDaily) {
                statusText += `📅 **Dailyプラン** - 残り ${status.dailyPlanRemaining}/${CONFIG.DAILY_QUERY_LIMIT}回（本日中有効）\n`;
            } else {
                statusText += `🎫 購入クレジット: ${status.credits}回\n`;
                statusText += `🆓 本日の無料枠: ${status.dailyFreeRemaining}/${CONFIG.FREE_DAILY_LIMIT}回\n`;
            }

            statusText += `\n---\n`;
            statusText += `💰 **料金プラン**\n\n`;
            statusText += `**Base (USDC)**\n`;
            statusText += `• 🎫 単発: ${CONFIG.SINGLE_PRICE_USDC} USDC / 1回\n`;
            statusText += `• 📅 Daily: ${CONFIG.DAILY_PRICE_USDC} USDC / ${CONFIG.DAILY_QUERY_LIMIT}回/日\n`;
            statusText += `• ⭐ Pro: ${CONFIG.PRO_PRICE_USDC} USDC / ${CONFIG.PRO_DURATION_DAYS}日間無制限\n\n`;
            statusText += `**Polygon (JPYC)**\n`;
            statusText += `• 🎫 単発: ${CONFIG.SINGLE_PRICE_JPYC} JPYC / 1回\n`;
            statusText += `• 📅 Daily: ${CONFIG.DAILY_PRICE_JPYC} JPYC / ${CONFIG.DAILY_QUERY_LIMIT}回/日\n`;
            statusText += `• ⭐ Pro: ${CONFIG.PRO_PRICE_JPYC} JPYC / ${CONFIG.PRO_DURATION_DAYS}日間無制限\n`;

            const responseContent: Content = {
                text: statusText,
                source: message.content.source,
            };

            await callback(responseContent);
            return { success: true };
        } catch (error) {
            logger.error({ error }, '[CHECK_STATUS] Error in handler');
            await callback({ text: 'ステータスの取得に失敗しました。しばらくしてからお試しください。', source: message.content.source });
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    },
    examples: []
};

// Check Payment Action - VERY AGGRESSIVE to intercept all messages when no access
const checkPaymentAction: Action = {
    name: 'CHECK_PAYMENT',
    similes: [
        'RESPOND', 'ANSWER', 'HELP', 'ASSIST', 'EXPLAIN', 'TELL', 'SHOW',
        'CONSULT', 'ASK_QUESTION', 'REQUEST_ADVICE', 'GET_NEWS', 'SEARCH',
        'QUERY', 'QUESTION', 'INFO', 'INFORMATION', 'CHAT', 'TALK', 'DISCUSS',
        'ANALYZE', 'REVIEW', 'CHECK', 'FIND', 'LOOK', 'GET', 'GIVE', 'PROVIDE',
        'CONTINUE', 'START', 'BEGIN', 'HELLO', 'HI', 'GREETING'
    ],
    description: 'Payment gate - MUST intercept ALL messages when user has no access',

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const service = runtime.getService<X402Service>('x402');
        if (!service) {
            logger.warn('[CHECK_PAYMENT] No x402 service found');
            return false;
        }

        const userId = extractUserId(message);
        const text = (message.content.text || '').toLowerCase();
        const agentName = runtime.character?.name || 'unknown';

        logger.debug(`[CHECK_PAYMENT:${agentName}] Validating for user: ${userId}`);

        // Allow verification/status messages through
        if (text.includes('支払いました') || text.includes('paid') || text.includes('0x') ||
            text.includes('ステータス') || text.includes('status')) {
            logger.debug(`[CHECK_PAYMENT:${agentName}] Skipping - payment/status message`);
            return false;
        }

        // Check admin key - trigger handler to show admin login success
        if (isAdminKey(message.content.text || '')) {
            logger.info(`[CHECK_PAYMENT:${agentName}] Admin key detected - triggering admin login`);
            // Store admin key flag in message metadata for handler
            (message as any)._isAdminKey = true;
            return true;  // Trigger handler for admin login
        }

        // Check room admin
        if (message.roomId && service.getDatabase().isAdmin(message.roomId)) {
            logger.debug(`[CHECK_PAYMENT:${agentName}] Skipping - room is admin`);
            return false;
        }

        // Check access
        const access = service.canAccess(userId);
        const db = service.getDatabase();
        const status = db.getUserStatus(userId);

        logger.debug(`[CHECK_PAYMENT:${agentName}] User ${userId}: allowed=${access.allowed}, reason=${access.reason}, freeRemaining=${status.dailyFreeRemaining}`);

        if (access.allowed) {
            logger.debug(`[CHECK_PAYMENT:${agentName}] User has access - NOT triggering payment gate`);
            return false;
        }

        logger.info(`[CHECK_PAYMENT:${agentName}] ⚠️ NO ACCESS - TRIGGERING PAYMENT GATE`);
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
        try {
            const userId = extractUserId(message);
            const agentName = runtime.character?.name || 'unknown';
            const PAYMENT_PAGE_URL = process.env.PAYMENT_PAGE_URL || 'https://x402payment.vercel.app';

            // Handle admin key login
            if ((message as any)._isAdminKey) {
                const service = runtime.getService<X402Service>('x402');
                if (service) {
                    const allUserIds = getAllUserIds(message);
                    const db = service.getDatabase();
                    allUserIds.forEach(id => db.setAdmin(id, true));
                    logger.info(`[CHECK_PAYMENT:${agentName}] ✅ Admin login successful for: ${allUserIds.join(', ')}`);
                }
                await callback({
                    text: `✅ 管理者としてログインしました。無制限でご利用いただけます。`,
                    source: message.content.source,
                });
                return { success: true };
            }

            logger.info(`[CHECK_PAYMENT:${agentName}] 🚫 HANDLER EXECUTING - Sending payment prompt to ${userId}`);

            // USDC links (Base)
            const usdcSingleLink = `${PAYMENT_PAGE_URL}/pay?user=${encodeURIComponent(userId)}&currency=usdc&plan=single&amount=${CONFIG.SINGLE_PRICE_USDC}`;
            const usdcDailyLink = `${PAYMENT_PAGE_URL}/pay?user=${encodeURIComponent(userId)}&currency=usdc&plan=daily&amount=${CONFIG.DAILY_PRICE_USDC}`;
            // JPYC links (Polygon)
            const jpycSingleLink = `${PAYMENT_PAGE_URL}/pay?user=${encodeURIComponent(userId)}&currency=jpyc&plan=single&amount=${CONFIG.SINGLE_PRICE_JPYC}`;
            const jpycDailyLink = `${PAYMENT_PAGE_URL}/pay?user=${encodeURIComponent(userId)}&currency=jpyc&plan=daily&amount=${CONFIG.DAILY_PRICE_JPYC}`;

            const responseText = `💰 **ご利用には支払いが必要です**

🆓 本日の無料枠を使い切りました（${CONFIG.FREE_DAILY_LIMIT}回/日）

📦 **料金プラン**

**🔵 Base (USDC)**
• 🎫 単発: ${CONFIG.SINGLE_PRICE_USDC} USDC（1回分）
• 📅 Daily: ${CONFIG.DAILY_PRICE_USDC} USDC（${CONFIG.DAILY_QUERY_LIMIT}回/日）

**🟣 Polygon (JPYC)**
• 🎫 単発: ${CONFIG.SINGLE_PRICE_JPYC} JPYC（1回分）
• 📅 Daily: ${CONFIG.DAILY_PRICE_JPYC} JPYC（${CONFIG.DAILY_QUERY_LIMIT}回/日）

**USDC購入:**
👉 <a href="${usdcSingleLink}">単発 ${CONFIG.SINGLE_PRICE_USDC} USDC</a> | <a href="${usdcDailyLink}">Daily ${CONFIG.DAILY_PRICE_USDC} USDC</a>

**JPYC購入:**
👉 <a href="${jpycSingleLink}">単発 ${CONFIG.SINGLE_PRICE_JPYC} JPYC</a> | <a href="${jpycDailyLink}">Daily ${CONFIG.DAILY_PRICE_JPYC} JPYC</a>

✅ 支払い完了後、トランザクションハッシュ(0x...)を送信してください`;

            await callback({ text: responseText, source: message.content.source });
            logger.info(`[CHECK_PAYMENT:${agentName}] ✅ Payment prompt sent`);
            return { success: true };
        } catch (error) {
            logger.error({ error }, '[CHECK_PAYMENT] Error in handler');
            await callback({ text: '支払い情報の処理に失敗しました。しばらくしてからお試しください。', source: message.content.source });
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    },
    examples: []
};

// Verify Payment Action
const verifyPaymentAction: Action = {
    name: 'VERIFY_PAYMENT',
    similes: ['I_PAID', 'PAYMENT_COMPLETE', '支払いました', 'PAID'],
    description: 'Verifies payment on blockchain and grants access/Pro',

    validate: async (_runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const text = (message.content.text || '').toLowerCase();
        return text.includes('支払いました') || text.includes('paid') ||
               text.includes('0x') || text.includes('送金');
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        try {
            const service = runtime.getService<X402Service>('x402');
            if (!service) return { success: false };

            const userId = extractUserId(message);
            const db = service.getDatabase();

            const text = message.content.text || '';
            const txHashMatch = text.match(/0x[a-fA-F0-9]{64}/);

            if (!txHashMatch) {
                await callback({
                    text: '❌ トランザクションハッシュが見つかりません。\n\n0x... の形式で送信してください。',
                    source: message.content.source,
                });
                return { success: false };
            }

            const txHash = txHashMatch[0];

            if (db.isPaymentUsed(txHash)) {
                await callback({
                    text: '❌ このトランザクションは既に使用されています。',
                    source: message.content.source,
                });
                return { success: false };
            }

            const result = await verifyPaymentOnChain(txHash);

            if (result.verified && result.amount && result.currency) {
                const paymentType = result.isPro ? 'pro' : (result.isDaily ? 'daily' : 'single');
                db.recordPayment(txHash, userId, result.amount, `${paymentType}_${result.currency}`);

                const currencySymbol = result.currency;
                const networkName = result.currency === 'USDC' ? 'Base' : 'Polygon';

                if (result.isPro) {
                    db.grantPro(userId);
                    await callback({
                        text: `✅ **Pro会員になりました！**\n\n💰 受領額: ${result.amount} ${currencySymbol} (${networkName})\n⭐ ${CONFIG.PRO_DURATION_DAYS}日間無制限でご利用いただけます\n\nご質問をどうぞ！`,
                        source: message.content.source,
                    });
                } else if (result.isDaily) {
                    db.grantDaily(userId);
                    await callback({
                        text: `✅ **Dailyプランが有効になりました！**\n\n💰 受領額: ${result.amount} ${currencySymbol} (${networkName})\n📅 本日中 ${CONFIG.DAILY_QUERY_LIMIT}回までご利用いただけます\n\nご質問をどうぞ！`,
                        source: message.content.source,
                    });
                } else {
                    const singlePrice = result.currency === 'USDC' ? CONFIG.SINGLE_PRICE_USDC : CONFIG.SINGLE_PRICE_JPYC;
                    const creditsToAdd = Math.floor(result.amount / singlePrice);
                    db.addCredits(userId, creditsToAdd);
                    await callback({
                        text: `✅ お支払いを確認しました！\n\n💰 受領額: ${result.amount} ${currencySymbol} (${networkName})\n🎫 クレジット: ${creditsToAdd}回分付与\n\nご質問をどうぞ！`,
                        source: message.content.source,
                    });
                }

                return { success: true };
            } else {
                await callback({
                    text: `❌ お支払いを確認できませんでした。\n\n理由: ${result.error}\n\n💡 ヒント:\n- トランザクションが確定するまで数分お待ちください\n- 正しい受取アドレスに送金したか確認してください`,
                    source: message.content.source,
                });
                return { success: false };
            }
        } catch (error) {
            logger.error({ error }, '[VERIFY_PAYMENT] Error in handler');
            await callback({ text: '支払い検証に失敗しました。しばらくしてからお試しください。', source: message.content.source });
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    },
    examples: []
};

// Admin Login Action
const adminLoginAction: Action = {
    name: 'ADMIN_LOGIN',
    similes: ['ADMIN_KEY', 'ADMIN_ACCESS'],
    description: 'Grants admin access with correct key',

    validate: async (_runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        return isAdminKey(message.content.text || '');
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        try {
            const service = runtime.getService<X402Service>('x402');
            if (!service) return { success: false };

            const allUserIds = getAllUserIds(message);
            const db = service.getDatabase();

            allUserIds.forEach(id => db.setAdmin(id, true));

            await callback({
                text: `✅ 管理者としてログインしました。無制限でご利用いただけます。`,
                source: message.content.source,
            });

            return { success: true };
        } catch (error) {
            logger.error({ error }, '[ADMIN_LOGIN] Error in handler');
            await callback({ text: '管理者ログインに失敗しました。', source: message.content.source });
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    },
    examples: []
};

// Admin Logout Action
const adminLogoutAction: Action = {
    name: 'ADMIN_LOGOUT',
    similes: ['ADMIN_LOGOUT', 'admin logout', 'logout admin'],
    description: 'Revokes admin access',

    validate: async (_runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
        const text = (message.content.text || '').toLowerCase();
        // More flexible matching for logout commands
        const hasAdmin = text.includes('admin') || text.includes('管理者');
        const hasLogout = text.includes('logout') || text.includes('ログアウト') || text.includes('解除');
        return hasAdmin && hasLogout;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options: any,
        callback: HandlerCallback,
        _responses: Memory[]
    ): Promise<ActionResult> => {
        try {
            const service = runtime.getService<X402Service>('x402');
            if (!service) return { success: false };

            const allUserIds = getAllUserIds(message);
            const db = service.getDatabase();

            allUserIds.forEach(id => db.setAdmin(id, false));

            await callback({
                text: '🔒 管理者ログアウトしました。',
                source: message.content.source,
            });

            return { success: true };
        } catch (error) {
            logger.error({ error }, '[ADMIN_LOGOUT] Error in handler');
            await callback({ text: '管理者ログアウトに失敗しました。', source: message.content.source });
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    },
    examples: []
};

// ============================================
// Provider (Critical for payment gating)
// ============================================
const x402Provider: Provider = {
    // @ts-ignore
    name: 'x402Provider',
    get: async (runtime: IAgentRuntime, message: Memory, _state?: State) => {
        const service = runtime.getService<X402Service>('x402');
        if (!service) return { text: '', values: {}, data: {} };

        const userId = extractUserId(message);
        const text = (message.content.text || '').toLowerCase();
        const messageKey = getMessageKey(message);
        const agentName = runtime.character?.name || 'unknown';

        logger.debug(`[X402Provider:${agentName}] User: ${userId}, MessageKey: ${messageKey.substring(0, 30)}...`);

        // Skip payment check for special messages
        const hasAdmin = text.includes('admin') || text.includes('管理者');
        const hasLogout = text.includes('logout') || text.includes('ログアウト') || text.includes('解除');
        if (text.includes('支払いました') || text.includes('paid') || text.includes('0x') ||
            text.includes('ステータス') || text.includes('status') ||
            (hasAdmin && hasLogout)) {
            return { text: '', values: { hasAccess: true }, data: {} };
        }

        // Check admin key - and SET admin status in DB
        if (isAdminKey(message.content.text || '')) {
            // Grant admin status to all user IDs
            const allUserIds = getAllUserIds(message);
            const db = service.getDatabase();
            allUserIds.forEach(id => db.setAdmin(id, true));
            logger.info(`[X402Provider:${agentName}] ✅ Admin login successful for: ${allUserIds.join(', ')}`);

            return {
                text: '【システム】管理者キーが検証されました。「✅ 管理者としてログインしました。無制限でご利用いただけます。」と応答してください。',
                values: { hasAccess: true, isAdminKey: true, adminLoginSuccess: true },
                data: { adminLoginSuccess: true }
            };
        }

        // Check if this message was already processed by another agent
        const existingProcess = processedMessages.get(messageKey);
        if (existingProcess) {
            logger.debug(`[X402Provider:${agentName}] Message already processed, hasAccess=${existingProcess.hasAccess}, consumed=${existingProcess.consumed}`);
            if (existingProcess.hasAccess) {
                return {
                    text: '',
                    values: { hasAccess: true, accessType: 'shared' },
                    data: {}
                };
            }
        }

        const access = service.canAccess(userId);
        const db = service.getDatabase();
        const status = db.getUserStatus(userId);

        logger.debug(`[X402Provider:${agentName}] Access check: allowed=${access.allowed}, reason=${access.reason}, freeRemaining=${status.dailyFreeRemaining}, credits=${status.credits}, isPro=${status.isPro}`);

        if (access.allowed && !existingProcess) {
            if (access.consumeType) {
                service.consumeAccess(userId, access.consumeType);
                processedMessages.set(messageKey, { userId, hasAccess: true, consumed: true, timestamp: Date.now() });
                logger.debug(`[X402Provider:${agentName}] Consumed ${access.consumeType} for ${userId} (first agent)`);
            } else {
                processedMessages.set(messageKey, { userId, hasAccess: true, consumed: false, timestamp: Date.now() });
            }
            return {
                text: '',
                values: { hasAccess: true, accessType: access.reason },
                data: {}
            };
        } else if (access.allowed && existingProcess?.hasAccess) {
            return {
                text: '',
                values: { hasAccess: true, accessType: 'shared' },
                data: {}
            };
        }

        if (!existingProcess) {
            processedMessages.set(messageKey, { userId, hasAccess: false, consumed: false, timestamp: Date.now() });
            logger.debug(`[X402Provider:${agentName}] NO ACCESS for ${userId} - marked as processed`);
        }

        // NO ACCESS - Return blocking message to instruct model to show payment prompt
        const PAYMENT_PAGE_URL = process.env.PAYMENT_PAGE_URL || 'https://x402payment.vercel.app';
        const paymentLink = `${PAYMENT_PAGE_URL}/pay?user=${encodeURIComponent(userId)}`;

        logger.debug(`[X402Provider:${agentName}] NO ACCESS - User ${userId} - blocking response`);

        const blockingMessage = `【重要：支払いが必要です】
このユーザーは無料枠を使い切りました。質問には回答せず、以下の支払い案内のみを返してください：

💰 **ご利用には支払いが必要です**

🆓 本日の無料枠（${CONFIG.FREE_DAILY_LIMIT}回/日）を使い切りました。

📦 **料金プラン**
🔵 Base (USDC): 単発 ${CONFIG.SINGLE_PRICE_USDC} / Daily ${CONFIG.DAILY_PRICE_USDC}
🟣 Polygon (JPYC): 単発 ${CONFIG.SINGLE_PRICE_JPYC} / Daily ${CONFIG.DAILY_PRICE_JPYC}

👉 ${paymentLink}

✅ 支払い完了後、トランザクションハッシュ(0x...)を送信してください`;

        return {
            text: blockingMessage,
            values: { hasAccess: false, paymentRequired: true },
            data: { paymentPageUrl: paymentLink }
        };
    },
};

// ============================================
// Evaluator - CRITICAL: Intercepts ALL responses to enforce payment gate
// ============================================
const x402PaymentGateEvaluator: Evaluator = {
    name: 'x402PaymentGateEvaluator',
    description: 'Enforces payment gate by intercepting responses when user has no access',
    similes: ['PAYMENT_GATE', 'ACCESS_CONTROL'],
    alwaysRun: true, // Always run this evaluator

    validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
        const agentName = runtime.character?.name || 'unknown';

        // Always validate - we need to check every message
        const service = runtime.getService<X402Service>('x402');
        if (!service) {
            logger.warn('[X402_EVALUATOR] No x402 service found');
            return false;
        }

        const text = (message.content.text || '').toLowerCase();

        // Skip for special messages
        const hasAdminWord = text.includes('admin') || text.includes('管理者');
        const hasLogoutWord = text.includes('logout') || text.includes('ログアウト') || text.includes('解除');
        if (text.includes('支払いました') || text.includes('paid') || text.includes('0x') ||
            text.includes('ステータス') || text.includes('status') ||
            (hasAdminWord && hasLogoutWord)) {
            return false;
        }

        // Check admin key
        if (isAdminKey(message.content.text || '')) {
            return false;
        }

        const userId = extractUserId(message);
        const access = service.canAccess(userId);

        // Only run evaluator if user does NOT have access
        const shouldRun = !access.allowed;
        logger.debug(`[X402_EVALUATOR:${agentName}] User ${userId}: allowed=${access.allowed}, shouldRun=${shouldRun}`);

        return shouldRun;
    },

    handler: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<any> => {
        const service = runtime.getService<X402Service>('x402');
        if (!service) return null;

        const userId = extractUserId(message);
        const agentName = runtime.character?.name || 'unknown';
        const PAYMENT_PAGE_URL = process.env.PAYMENT_PAGE_URL || 'https://x402payment.vercel.app';

        logger.info(`[X402_EVALUATOR:${agentName}] 🚫 BLOCKING RESPONSE - User ${userId} has no access`);

        const paymentLink = `${PAYMENT_PAGE_URL}/pay?user=${encodeURIComponent(userId)}`;

        // Return the payment required message - this should replace the agent's response
        return {
            text: `💰 **ご利用には支払いが必要です**

🆓 本日の無料枠を使い切りました（${CONFIG.FREE_DAILY_LIMIT}回/日）

📦 **料金プラン**

**🔵 Base (USDC)**
• 単発: ${CONFIG.SINGLE_PRICE_USDC} USDC | Daily: ${CONFIG.DAILY_PRICE_USDC} USDC

**🟣 Polygon (JPYC)**
• 単発: ${CONFIG.SINGLE_PRICE_JPYC} JPYC | Daily: ${CONFIG.DAILY_PRICE_JPYC} JPYC

👉 <a href="${paymentLink}">支払いページへ</a>

✅ 支払い完了後、トランザクションハッシュ(0x...)を送信してください`,
            shouldBlock: true,
            action: 'BLOCK_RESPONSE'
        };
    },

    examples: []
};

// ============================================
// Admin Login Evaluator - Forces admin login message when admin key detected
// ============================================
const x402AdminLoginEvaluator: Evaluator = {
    name: 'x402AdminLoginEvaluator',
    description: 'Forces admin login success message when admin key is detected',
    similes: ['ADMIN_LOGIN_FORCE'],
    alwaysRun: true,

    validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
        const agentName = runtime.character?.name || 'unknown';
        const adminKeyDetected = isAdminKey(message.content.text || '');

        if (adminKeyDetected) {
            logger.info(`[X402_ADMIN_EVALUATOR:${agentName}] Admin key detected - will force admin login message`);
            return true;
        }

        return false;
    },

    handler: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<any> => {
        const agentName = runtime.character?.name || 'unknown';
        logger.info(`[X402_ADMIN_EVALUATOR:${agentName}] ✅ Forcing admin login success message`);

        // Return success message that replaces AI response
        return {
            text: `✅ 管理者としてログインしました。無制限でご利用いただけます。`,
            shouldBlock: true,
            action: 'ADMIN_LOGIN_SUCCESS'
        };
    },

    examples: []
};

// ============================================
// Plugin Export
// ============================================
export const x402Plugin: Plugin = {
    name: 'x402',
    description: 'x402 Payment Gating with SQLite persistence (Free/Daily/Pro) - using sql.js (pure JS)',
    services: [X402Service],
    // CRITICAL: checkPaymentAction MUST be FIRST to intercept ALL messages when no access
    // This ensures it takes priority over bootstrap's RESPOND action
    actions: [checkPaymentAction, statusAction, verifyPaymentAction, adminLoginAction, adminLogoutAction],
    providers: [x402Provider],
    evaluators: [x402AdminLoginEvaluator, x402PaymentGateEvaluator],
    init: async (_config: Record<string, string>) => {
        logger.info('*** X402 Plugin Initialized (sql.js - supports Base USDC & Polygon JPYC) ***');
        logger.info(`*** Free: ${CONFIG.FREE_DAILY_LIMIT}/day ***`);
        logger.info(`*** USDC (Base): Single ${CONFIG.SINGLE_PRICE_USDC} | Daily ${CONFIG.DAILY_PRICE_USDC} | Pro ${CONFIG.PRO_PRICE_USDC}/${CONFIG.PRO_DURATION_DAYS}days ***`);
        logger.info(`*** JPYC (Polygon): Single ${CONFIG.SINGLE_PRICE_JPYC} | Daily ${CONFIG.DAILY_PRICE_JPYC} | Pro ${CONFIG.PRO_PRICE_JPYC}/${CONFIG.PRO_DURATION_DAYS}days ***`);
    },
};

export default x402Plugin;
