import type { IAgentRuntime } from '@elizaos/core';
import { Service } from '@elizaos/core';
import { ethers } from 'ethers';
import {
    ERC8004_SERVICE_NAME,
    ERC8004_ABI,
    DEFAULT_CHAIN_ID,
    DEFAULT_RPC_URLS,
    CACHE_KEYS,
    CACHE_TTL,
} from './constants';
import { validateERC8004Config } from './environment';
import type {
    AgentInfo,
    AgentRegistration,
    AgentEndorsement,
    AgentReport,
    TransactionResult,
    ReputationScore,
    ERC8004Registry,
    RegistrationHandler,
} from './types';
import type { ERC8004ConfigOptions } from './environment';
import { RegistryManager } from './registry-manager';

/**
 * ERC8004Service - Service for interacting with ERC-8004 on-chain reputation system
 * Provides identity management and reputation tracking for autonomous agents
 */
export class ERC8004Service extends Service {
    static serviceType: string = ERC8004_SERVICE_NAME;
    capabilityDescription =
        'The agent can interact with ERC-8004 on-chain reputation system for identity and reputation management';

    private provider!: ethers.JsonRpcProvider;
    private contract: ethers.Contract | null = null;
    private wallet: ethers.Wallet | null = null;
    private contractAddress!: string;
    private chainId!: number;
    private configuredAgentId?: string; // Agent ID from config (ERC8004_AGENT_ID, BABYLON_AGENT_ID, or character.name)
    private configOptions?: ERC8004ConfigOptions;
    private registryManager: RegistryManager;
    private hasWarnedReadOnly: boolean = false; // Track if we've already warned about read-only mode
    private handlers: Map<string, RegistrationHandler> = new Map();

    constructor(protected runtime: IAgentRuntime, configOptions?: ERC8004ConfigOptions) {
        super();
        this.configOptions = configOptions;
        this.registryManager = new RegistryManager(runtime);
        this.initializeStandardHandler();
    }

    /**
     * Initialize the default 'standard' handler for generic ERC-8004 contracts
     */
    private initializeStandardHandler(): void {
        const standardHandler: RegistrationHandler = {
            type: 'standard',
            requiredParams: [
                {
                    name: 'agentId',
                    description: 'Unique identifier for the agent (lowercase with hyphens)',
                    required: true,
                },
                {
                    name: 'name',
                    description: 'Display name for the agent',
                    required: true,
                },
                {
                    name: 'domain',
                    description: 'The domain or service the agent operates on',
                    required: true,
                    default: 'eliza.os',
                },
            ],
            register: async (runtime: IAgentRuntime, params: Record<string, any>): Promise<TransactionResult> => {
                const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
                if (!service) {
                    return {
                        success: false,
                        error: 'ERC8004Service not available',
                    };
                }

                if (!service.getContract()) {
                    return {
                        success: false,
                        error: 'Contract not initialized. Set ERC8004_CONTRACT_ADDRESS or register a registry using registerERC8004Registry() to enable registration.',
                    };
                }

                if (!service.canWrite()) {
                    return {
                        success: false,
                        error: 'No wallet configured for write operations',
                    };
                }

                const agentId = params.agentId as string;
                const name = params.name as string;
                const domain = params.domain as string || 'eliza.os';

                try {
                    runtime.logger.info(`Registering agent: ${agentId}`);
                    const contract = service.getContract()!;
                    const tx = await contract.registerAgent(agentId, name, domain);

                    const receipt = await tx.wait();
                    runtime.logger.info(`Agent registered successfully. TX: ${receipt?.hash || 'unknown'}`);

                    // Invalidate cache
                    await service.invalidateAgentCache(agentId);

                    return {
                        success: true,
                        transactionHash: receipt?.hash || '',
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    runtime.logger.error(`Error registering agent ${agentId}:`, errorMessage);
                    return {
                        success: false,
                        error: errorMessage,
                    };
                }
            },
        };

        this.handlers.set('standard', standardHandler);
    }

    /**
     * Register a custom registration handler
     */
    registerHandler(handler: RegistrationHandler): boolean {
        if (!handler.type || !handler.requiredParams || !handler.register) {
            this.runtime.logger.error('Invalid handler: missing required fields (type, requiredParams, register)');
            return false;
        }

        this.handlers.set(handler.type, handler);
        this.runtime.logger.info(`Registered ERC-8004 registration handler: ${handler.type}`);
        return true;
    }

    /**
     * Get handler for a contract address by looking up the registry
     */
    async getHandlerForAddress(contractAddress: string): Promise<RegistrationHandler | null> {
        if (!contractAddress) {
            return this.handlers.get('standard') || null;
        }
        try {
            const registries = await this.registryManager.getRegistries();
            const registry = registries.find((r) => r.contractAddress.toLowerCase() === contractAddress.toLowerCase());

            if (!registry) {
                this.runtime.logger.debug(`No registry found for contract ${contractAddress}, using standard handler`);
                return this.handlers.get('standard') || null;
            }

            const handlerType = registry.handlerType || 'standard';
            const handler = this.handlers.get(handlerType) || this.handlers.get('standard') || null;

            this.runtime.logger.debug({
                contractAddress,
                registryId: registry.id,
                registryHandlerType: registry.handlerType,
                resolvedHandlerType: handlerType,
                handlerFound: !!handler,
                availableHandlers: Array.from(this.handlers.keys()),
            }, 'Handler lookup result');

            return handler;
        } catch (error) {
            this.runtime.logger.error({ error }, 'Error getting handler for address');
            return this.handlers.get('standard') || null;
        }
    }

    /**
     * Initialize the service with configuration from runtime or passed options
     */
    async initialize(): Promise<void> {
        try {
            // Debug: Log what settings are available before validation
            const hasErc8004Key = !!this.runtime.getSetting('ERC8004_PRIVATE_KEY');
            const hasEvmKey = !!this.runtime.getSetting('EVM_PRIVATE_KEY');
            this.runtime.logger.debug({
                hasErc8004Key,
                hasEvmKey,
            }, 'ERC-8004: Checking available private key sources...');

            const config = await validateERC8004Config(this.runtime, this.configOptions);

            // Debug: Log what contract address sources are available
            const hasErc8004Address = !!this.runtime.getSetting('ERC8004_CONTRACT_ADDRESS');
            this.runtime.logger.debug({
                hasErc8004Address,
                configHasAddress: !!config.ERC8004_CONTRACT_ADDRESS,
            }, 'ERC-8004: Checking available contract address sources...');

            // Store the configured agent ID (derived from ERC8004_AGENT_ID, BABYLON_AGENT_ID, character.name, or runtime.agentId)
            this.configuredAgentId = config.ERC8004_AGENT_ID;
            this.runtime.logger.debug({
                configuredAgentId: this.configuredAgentId,
                runtimeAgentId: this.runtime.agentId,
            }, 'ERC-8004: Agent ID configuration');

            // If no contract address is configured, service runs in read-only mode
            if (!config.ERC8004_CONTRACT_ADDRESS) {
                this.runtime.logger.warn(
                    'ERC-8004: No contract address configured - service will run in limited mode. ' +
                    'Set ERC8004_CONTRACT_ADDRESS or register a registry using registerERC8004Registry() to enable full functionality.'
                );
                // Still initialize with defaults for read-only operations
                this.chainId = config.ERC8004_CHAIN_ID || DEFAULT_CHAIN_ID;
                const rpcUrl = config.ERC8004_RPC_URL || DEFAULT_RPC_URLS[this.chainId];
                if (rpcUrl) {
                    this.provider = new ethers.JsonRpcProvider(rpcUrl);
                }
                return; // Exit early - can't do much without a contract address
            }

            // Setup provider with chain-specific defaults
            this.chainId = config.ERC8004_CHAIN_ID || DEFAULT_CHAIN_ID;
            const rpcUrl = config.ERC8004_RPC_URL || DEFAULT_RPC_URLS[this.chainId];

            if (!rpcUrl) {
                throw new Error(
                    `No RPC URL available for chain ${this.chainId}. ` +
                    `Set ERC8004_RPC_URL, BASE_SEPOLIA_RPC_URL, or EVM_PROVIDER_URL to enable.`
                );
            }

            this.provider = new ethers.JsonRpcProvider(rpcUrl);

            // Setup contract
            this.contractAddress = config.ERC8004_CONTRACT_ADDRESS;
            this.contract = new ethers.Contract(this.contractAddress, ERC8004_ABI, this.provider) as ethers.Contract;

            // Setup wallet if private key is provided
            if (config.ERC8004_PRIVATE_KEY) {
                try {
                    this.wallet = new ethers.Wallet(config.ERC8004_PRIVATE_KEY, this.provider);
                    this.contract = this.contract.connect(this.wallet) as ethers.Contract;

                    // Check which source the private key came from for logging
                    const keySource =
                        this.configOptions?.privateKey ? 'options' :
                            this.runtime.getSetting('ERC8004_PRIVATE_KEY') ? 'ERC8004_PRIVATE_KEY' :
                                this.runtime.getSetting('EVM_PRIVATE_KEY') ? 'EVM_PRIVATE_KEY (plugin-evm fallback)' :
                                    'unknown';

                    this.runtime.logger.info(`ERC-8004: Service initialized with wallet: ${this.wallet.address} (key from: ${keySource})`);
                } catch (error) {
                    this.runtime.logger.error(
                        {
                            error: error instanceof Error ? error.message : String(error),
                            privateKeyLength: config.ERC8004_PRIVATE_KEY?.length,
                            privateKeyPrefix: config.ERC8004_PRIVATE_KEY?.substring(0, 4),
                        },
                        'ERC-8004: Failed to create wallet from private key - check key format'
                    );
                    throw error;
                }
            } else {
                this.runtime.logger.warn(
                    'ERC-8004: Service initialized without private key - read-only mode. ' +
                    'Set ERC8004_PRIVATE_KEY, BABYLON_GAME_PRIVATE_KEY, or EVM_PRIVATE_KEY to enable write operations.'
                );
                this.runtime.logger.debug({
                    hasErc8004Key,
                    hasEvmKey,
                    configHasKey: !!config.ERC8004_PRIVATE_KEY,
                }, 'ERC-8004: Private key not found in config after validation');
            }

            this.runtime.logger.info(`ERC-8004: Service initialized on chain ${this.chainId} (${this.getChainName(this.chainId)}) at ${this.contractAddress}`);

            // Check and log agent registration status (async, non-blocking)
            this.checkAgentRegistrationStatus().catch((error) => {
                this.runtime.logger.error({
                    error: error instanceof Error ? error.message : String(error),
                    errorStack: error instanceof Error ? error.stack : undefined,
                }, 'ERC-8004: Failed to check agent registration status');
            });
        } catch (error) {
            this.runtime.logger.error('Failed to initialize ERC8004Service:', error as string);
            throw error;
        }
    }

    /**
     * Get provider instance
     */
    getProvider(): ethers.JsonRpcProvider {
        return this.provider;
    }

    /**
     * Get contract instance
     */
    getContract(): ethers.Contract | null {
        return this.contract;
    }

    /**
     * Get the configured agent ID for ERC-8004 registration checks
     * Priority: ERC8004_AGENT_ID > BABYLON_AGENT_ID > character.name > runtime.agentId (UUID)
     */
    getAgentId(): string {
        return this.configuredAgentId || this.runtime.agentId;
    }

    /**
     * Get wallet address if available
     */
    getWalletAddress(): string | null {
        return this.wallet?.address || null;
    }

    /**
     * Check if service has write capabilities (wallet configured)
     */
    canWrite(): boolean {
        return this.wallet !== null;
    }

    /**
     * Log a read-only mode warning (only once per service instance to avoid spam)
     */
    warnReadOnlyMode(): void {
        if (!this.hasWarnedReadOnly && !this.canWrite()) {
            this.hasWarnedReadOnly = true;
            this.runtime.logger.warn(
                'ERC8004Service is in read-only mode - write operations are disabled because no private key is configured. ' +
                'Set ERC8004_PRIVATE_KEY, BABYLON_GAME_PRIVATE_KEY, or EVM_PRIVATE_KEY to enable write operations.'
            );
        }
    }

    //
    // MARK: Agent Information Methods
    //

    /**
     * Get agent information from the registry
     */
    async getAgentInfo(agentId: string): Promise<AgentInfo | null> {
        // Check if contract is initialized
        if (!this.contract) {
            this.runtime.logger.debug(
                `ERC-8004: Contract not initialized - cannot fetch agent info for ${agentId}. ` +
                `Set ERC8004_CONTRACT_ADDRESS or BASE_IDENTITY_REGISTRY_ADDRESS to enable.`
            );
            return null;
        }

        try {
            const cacheKey = `${CACHE_KEYS.AGENT_INFO}:${agentId}`;
            const cached = await this.runtime.getCache<AgentInfo>(cacheKey);
            if (cached) {
                this.runtime.logger.debug(`Cache hit for agent info: ${agentId}`);
                return cached;
            }

            this.runtime.logger.debug(`Fetching agent info for: ${agentId}`);
            const result = await this.contract.getAgent(agentId);

            const agentInfo: AgentInfo = {
                owner: result.owner as string,
                name: result.name as string,
                domain: result.domain as string,
                active: result.active as boolean,
                reputation: BigInt(result.reputation.toString()),
                lastUpdate: BigInt(result.lastUpdate.toString()),
            };

            await this.runtime.setCache(cacheKey, agentInfo);
            return agentInfo;
        } catch (error) {
            // Handle "agent not found" gracefully - this is expected if agent isn't registered
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isNotFound =
                errorMessage.includes('missing revert data') ||
                errorMessage.includes('CALL_EXCEPTION') ||
                errorMessage.includes('revert');

            if (isNotFound) {
                // Agent not registered - this is normal, not an error
                this.runtime.logger.debug(`ERC-8004: Agent ${agentId} not found in registry (not registered)`);
                return null;
            }

            // Actual error - log it
            this.runtime.logger.error(`ERC-8004: Error fetching agent info for ${agentId}:`, errorMessage);
            return null;
        }
    }

    /**
     * Check if an agent is active
     */
    async isAgentActive(agentId: string): Promise<boolean> {
        // Check if contract is initialized
        if (!this.contract) {
            this.runtime.logger.debug(
                `ERC-8004: Contract not initialized - cannot check active status for ${agentId}. ` +
                `Set ERC8004_CONTRACT_ADDRESS or register a registry using registerERC8004Registry() to enable.`
            );
            return false;
        }

        try {
            const cacheKey = `${CACHE_KEYS.ACTIVE_STATUS}:${agentId}`;
            const cached = await this.runtime.getCache<boolean>(cacheKey);
            if (cached !== undefined && cached !== null) {
                return cached;
            }

            const isActive = await this.contract.isAgentActive(agentId) as boolean;
            await this.runtime.setCache(cacheKey, isActive);
            return isActive;
        } catch (error) {
            // Handle "agent not found" gracefully
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isNotFound =
                errorMessage.includes('missing revert data') ||
                errorMessage.includes('CALL_EXCEPTION') ||
                errorMessage.includes('revert');

            if (isNotFound) {
                // Agent not registered - return false (not active)
                this.runtime.logger.debug(`ERC-8004: Agent ${agentId} not found (not registered)`);
                return false;
            }

            // Actual error - log it
            this.runtime.logger.error(`ERC-8004: Error checking agent active status for ${agentId}:`, errorMessage);
            return false;
        }
    }

    /**
     * Get agent reputation score
     */
    async getAgentReputation(agentId: string): Promise<ReputationScore | null> {
        // Check if contract is initialized
        if (!this.contract) {
            this.runtime.logger.debug(
                `ERC-8004: Contract not initialized - cannot fetch reputation for ${agentId}. ` +
                `Set ERC8004_CONTRACT_ADDRESS or register a registry using registerERC8004Registry() to enable.`
            );
            return null;
        }

        try {
            const cacheKey = `${CACHE_KEYS.REPUTATION}:${agentId}`;
            const cached = await this.runtime.getCache<ReputationScore>(cacheKey);
            if (cached) {
                return cached;
            }

            const reputation = await this.contract.getAgentReputation(agentId);
            const score: ReputationScore = {
                agentId,
                score: BigInt(reputation.toString()),
                timestamp: Date.now(),
            };

            await this.runtime.setCache(cacheKey, score);
            return score;
        } catch (error) {
            // Handle "agent not found" gracefully
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isNotFound =
                errorMessage.includes('missing revert data') ||
                errorMessage.includes('CALL_EXCEPTION') ||
                errorMessage.includes('revert');

            if (isNotFound) {
                // Agent not registered - return null (no reputation)
                this.runtime.logger.debug(`ERC-8004: Agent ${agentId} not found (no reputation)`);
                return null;
            }

            // Actual error - log it
            this.runtime.logger.error(`ERC-8004: Error fetching reputation for ${agentId}:`, errorMessage);
            return null;
        }
    }

    //
    // MARK: Agent Management Methods (Write Operations)
    //

    /**
     * Register a new agent in the ERC-8004 registry
     * Uses the handler system to support different contract interfaces
     */
    async registerAgent(registration: AgentRegistration): Promise<TransactionResult> {
        // Get contract address (may not be initialized if no contract configured)
        const contractAddress = this.contractAddress || this.contract?.target as string;

        if (!contractAddress) {
            return {
                success: false,
                error: 'Contract not initialized. Set ERC8004_CONTRACT_ADDRESS or register a registry using registerERC8004Registry() to enable registration.',
            };
        }

        // Get handler for the contract address
        const handler = await this.getHandlerForAddress(contractAddress);

        if (!handler) {
            return {
                success: false,
                error: 'No registration handler available for this registry',
            };
        }

        // Use the handler to register
        return await handler.register(this.runtime, {
            agentId: registration.agentId,
            name: registration.name,
            domain: registration.domain,
        });
    }

    /**
     * Update agent information
     */
    async updateAgent(agentId: string, name: string, domain: string): Promise<TransactionResult> {
        if (!this.contract) {
            return {
                success: false,
                error: 'Contract not initialized. Set ERC8004_CONTRACT_ADDRESS to enable updates.',
            };
        }

        if (!this.canWrite()) {
            return {
                success: false,
                error: 'No wallet configured for write operations',
            };
        }

        try {
            this.runtime.logger.info(`Updating agent: ${agentId}`);
            const tx = await this.contract.updateAgent(agentId, name, domain);
            const receipt = await tx.wait();
            this.runtime.logger.info(`Agent updated successfully. TX: ${receipt?.hash || 'unknown'}`);

            await this.invalidateAgentCache(agentId);

            return {
                success: true,
                transactionHash: receipt?.hash || '',
            };
        } catch (error) {
            this.runtime.logger.error(`Error updating agent ${agentId}:`, error as string);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Deactivate an agent
     */
    async deactivateAgent(agentId: string): Promise<TransactionResult> {
        if (!this.contract) {
            return {
                success: false,
                error: 'Contract not initialized. Set ERC8004_CONTRACT_ADDRESS to enable deactivation.',
            };
        }

        if (!this.canWrite()) {
            return {
                success: false,
                error: 'No wallet configured for write operations',
            };
        }

        try {
            this.runtime.logger.info(`Deactivating agent: ${agentId}`);
            const tx = await this.contract.deactivateAgent(agentId);
            const receipt = await tx.wait();
            this.runtime.logger.info(`Agent deactivated successfully. TX: ${receipt?.hash || 'unknown'}`);

            await this.invalidateAgentCache(agentId);

            return {
                success: true,
                transactionHash: receipt?.hash || '',
            };
        } catch (error) {
            this.runtime.logger.error(`Error deactivating agent ${agentId}:`, error as string);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    //
    // MARK: Reputation Management Methods
    //

    /**
     * Endorse an agent (increase reputation)
     */
    async endorseAgent(endorsement: AgentEndorsement): Promise<TransactionResult> {
        if (!this.contract) {
            return {
                success: false,
                error: 'Contract not initialized. Set ERC8004_CONTRACT_ADDRESS to enable endorsements.',
            };
        }

        if (!this.canWrite()) {
            return {
                success: false,
                error: 'No wallet configured for write operations',
            };
        }

        try {
            this.runtime.logger.info(`Endorsing agent ${endorsement.agentId} with amount ${endorsement.amount}`);
            const tx = await this.contract.endorseAgent(endorsement.agentId, endorsement.amount);
            const receipt = await tx.wait();
            this.runtime.logger.info(`Agent endorsed successfully. TX: ${receipt?.hash || 'unknown'}`);

            // Invalidate reputation cache
            await this.runtime.setCache(`${CACHE_KEYS.REPUTATION}:${endorsement.agentId}`, null as any);

            return {
                success: true,
                transactionHash: receipt?.hash || '',
            };
        } catch (error) {
            this.runtime.logger.error(`Error endorsing agent ${endorsement.agentId}:`, error as string);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Penalize an agent (decrease reputation)
     */
    async penalizeAgent(penalization: AgentEndorsement): Promise<TransactionResult> {
        if (!this.contract) {
            return {
                success: false,
                error: 'Contract not initialized. Set ERC8004_CONTRACT_ADDRESS to enable penalization.',
            };
        }

        if (!this.canWrite()) {
            return {
                success: false,
                error: 'No wallet configured for write operations',
            };
        }

        try {
            this.runtime.logger.info(`Penalizing agent ${penalization.agentId} by ${penalization.amount} points`);
            const tx = await this.contract.penalizeAgent(penalization.agentId, penalization.amount);
            const receipt = await tx.wait();
            this.runtime.logger.info(`Agent penalized successfully. TX: ${receipt?.hash || 'unknown'}`);

            // Invalidate reputation cache
            await this.runtime.setCache(`${CACHE_KEYS.REPUTATION}:${penalization.agentId}`, null as any);

            return {
                success: true,
                transactionHash: receipt?.hash || '',
            };
        } catch (error) {
            this.runtime.logger.error(`Error penalizing agent ${penalization.agentId}:`, error as string);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Report an agent (for malicious behavior)
     */
    async reportAgent(report: AgentReport): Promise<TransactionResult> {
        if (!this.contract) {
            return {
                success: false,
                error: 'Contract not initialized. Set ERC8004_CONTRACT_ADDRESS to enable reporting.',
            };
        }

        if (!this.canWrite()) {
            return {
                success: false,
                error: 'No wallet configured for write operations',
            };
        }

        try {
            this.runtime.logger.info(`Reporting agent ${report.agentId} for: ${report.reason}`);
            const tx = await this.contract.reportAgent(report.agentId, report.reason);
            const receipt = await tx.wait();
            this.runtime.logger.info(`Agent reported successfully. TX: ${receipt?.hash || 'unknown'}`);

            // Invalidate reputation cache
            await this.runtime.setCache(`${CACHE_KEYS.REPUTATION}:${report.agentId}`, null as any);

            return {
                success: true,
                transactionHash: receipt?.hash || '',
            };
        } catch (error) {
            this.runtime.logger.error(`Error reporting agent ${report.agentId}:`, error as string);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    //
    // MARK: Multi-Registry Methods
    //

    /**
     * Get registry manager instance
     */
    getRegistryManager(): RegistryManager {
        return this.registryManager;
    }

    /**
     * Get agent information from a specific registry
     */
    async getAgentInfoFromRegistry(registryId: string, agentId: string): Promise<AgentInfo | null> {
        try {
            const registry = await this.registryManager.getRegistry(registryId);
            if (!registry) {
                this.runtime.logger.warn(`Registry ${registryId} not found`);
                return null;
            }

            // Create a provider for this registry
            const rpcUrl = registry.rpcUrl || DEFAULT_RPC_URLS[registry.chainId];
            if (!rpcUrl) {
                this.runtime.logger.error(`No RPC URL available for registry ${registryId} (chain ${registry.chainId})`);
                return null;
            }

            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const contract = new ethers.Contract(registry.contractAddress, ERC8004_ABI, provider);

            try {
                const result = await contract.getAgent(agentId);
                return {
                    owner: result.owner as string,
                    name: result.name as string,
                    domain: result.domain as string,
                    active: result.active as boolean,
                    reputation: BigInt(result.reputation.toString()),
                    lastUpdate: BigInt(result.lastUpdate.toString()),
                };
            } catch (error) {
                // Handle "agent not found" gracefully
                const errorMessage = error instanceof Error ? error.message : String(error);
                const isNotFound =
                    errorMessage.includes('missing revert data') ||
                    errorMessage.includes('CALL_EXCEPTION') ||
                    errorMessage.includes('revert');

                if (isNotFound) {
                    this.runtime.logger.debug(`ERC-8004: Agent ${agentId} not found in registry ${registryId}`);
                    return null;
                }
                throw error;
            }
        } catch (error) {
            this.runtime.logger.error(`Error fetching agent info from registry ${registryId}:`, error as string);
            return null;
        }
    }

    /**
     * Check agent registration status across all registries
     * Returns a Map of registryId to registration status
     */
    async checkAgentAcrossRegistries(agentId: string): Promise<Map<string, { registered: boolean; agentInfo: AgentInfo | null; isActive: boolean; reputation: ReputationScore | null }>> {
        const results = new Map<string, { registered: boolean; agentInfo: AgentInfo | null; isActive: boolean; reputation: ReputationScore | null }>();

        try {
            const registries = await this.registryManager.getRegistries();

            // Check each registry in parallel
            const checks = registries.map(async (registry) => {
                const agentInfo = await this.getAgentInfoFromRegistry(registry.id, agentId);
                const registered = agentInfo !== null;

                let isActive = false;
                let reputation: ReputationScore | null = null;

                if (agentInfo) {
                    isActive = agentInfo.active;
                    reputation = {
                        agentId,
                        score: agentInfo.reputation,
                        timestamp: Date.now(),
                    };
                }

                return {
                    registryId: registry.id,
                    result: {
                        registered,
                        agentInfo,
                        isActive,
                        reputation,
                    },
                };
            });

            const checkResults = await Promise.all(checks);
            for (const { registryId, result } of checkResults) {
                results.set(registryId, result);
            }
        } catch (error) {
            this.runtime.logger.error('Error checking agent across registries:', error as string);
        }

        return results;
    }

    //
    // MARK: Utility Methods
    //

    /**
     * Invalidate all cache entries for an agent
     */
    async invalidateAgentCache(agentId: string): Promise<void> {
        await Promise.all([
            this.runtime.setCache(`${CACHE_KEYS.AGENT_INFO}:${agentId}`, null as any),
            this.runtime.setCache(`${CACHE_KEYS.REPUTATION}:${agentId}`, null as any),
            this.runtime.setCache(`${CACHE_KEYS.ACTIVE_STATUS}:${agentId}`, null as any),
        ]);
    }

    /**
     * Format reputation score for display
     */
    formatReputation(score: bigint): string {
        return ethers.formatUnits(score, 0); // Assuming reputation is stored as integer
    }

    /**
     * Validate Ethereum address format
     */
    isValidAddress(address: string): boolean {
        return ethers.isAddress(address);
    }

    /**
     * Get human-readable chain name
     */
    private getChainName(chainId: number): string {
        const chainNames: Record<number, string> = {
            31337: 'Anvil (Local)',
            8453: 'Base Mainnet',
            84532: 'Base Sepolia',
            1: 'Ethereum Mainnet',
            11155111: 'Ethereum Sepolia',
        };
        return chainNames[chainId] || `Chain ${chainId}`;
    }

    /**
     * Check agent registration by wallet address (ERC721 NFT detection)
     * This is the most reliable method for Babylon-style registries that are ERC721 NFT contracts
     */
    private async checkRegistrationByWallet(walletAddress: string): Promise<{
        registered: boolean;
        tokenId?: bigint;
        agentInfo?: AgentInfo;
    }> {
        if (!this.contract || !this.provider) {
            return { registered: false };
        }

        try {
            // ERC721 ABI for NFT detection
            const erc721Abi = [
                'function balanceOf(address owner) view returns (uint256)',
                'function addressToTokenId(address) view returns (uint256)',
                'function getAgentInfo(uint256 tokenId) view returns (string name, string endpoint, bytes32 capabilitiesHash, string metadataCID)',
            ];

            const nftContract = new ethers.Contract(this.contractAddress, erc721Abi, this.provider);

            // Check if wallet has any NFTs (ERC721 balance check)
            try {
                const balance = await nftContract.balanceOf(walletAddress);
                const balanceBigInt = BigInt(balance.toString());

                if (balanceBigInt === BigInt(0)) {
                    this.runtime.logger.debug(`ERC-8004: Wallet ${walletAddress} has no NFTs in registry`);
                    return { registered: false };
                }

                this.runtime.logger.debug(`ERC-8004: Wallet ${walletAddress} has ${balanceBigInt} NFT(s) in registry`);
            } catch (error) {
                // balanceOf not supported - contract may not be ERC721
                this.runtime.logger.debug('ERC-8004: balanceOf not supported, skipping wallet-based check');
                return { registered: false };
            }

            // Try to get the token ID for this wallet
            let tokenId: bigint | undefined;
            try {
                const tokenIdResult = await nftContract.addressToTokenId(walletAddress);
                tokenId = BigInt(tokenIdResult.toString());
                this.runtime.logger.debug(`ERC-8004: Wallet ${walletAddress} owns token ID ${tokenId}`);
            } catch (error) {
                // addressToTokenId not supported - still registered based on balance
                this.runtime.logger.debug('ERC-8004: addressToTokenId not supported, but wallet has NFT balance');
                return { registered: true };
            }

            // Try to get agent info using the token ID
            let agentInfo: AgentInfo | undefined;
            try {
                const info = await nftContract.getAgentInfo(tokenId);
                if (info && info.name) {
                    agentInfo = {
                        owner: walletAddress,
                        name: info.name,
                        domain: info.endpoint || '',
                        active: true, // If we can retrieve info, agent is active
                        reputation: BigInt(0),
                        lastUpdate: BigInt(0),
                    };
                    this.runtime.logger.debug(`ERC-8004: Agent info retrieved for token ${tokenId}: ${info.name}`);
                }
            } catch (error) {
                // getAgentInfo not supported or failed - still registered based on tokenId
                this.runtime.logger.debug('ERC-8004: getAgentInfo not supported or failed, but wallet owns token');
            }

            return {
                registered: true,
                tokenId,
                agentInfo,
            };
        } catch (error) {
            this.runtime.logger.debug({
                error: error instanceof Error ? error.message : String(error),
            }, 'ERC-8004: Wallet-based registration check failed');
            return { registered: false };
        }
    }

    /**
     * Check and log agent registration status with ERC-8004
     * Uses wallet-based NFT detection first (most reliable), then falls back to agentId lookup
     */
    private async checkAgentRegistrationStatus(): Promise<void> {
        try {
            // If contract is not initialized, skip the check
            if (!this.contract) {
                this.runtime.logger.debug(
                    'ERC-8004: Skipping registration status check - contract not initialized. ' +
                    'Set ERC8004_CONTRACT_ADDRESS or register a registry using registerERC8004Registry() to enable.'
                );
                return;
            }

            const walletAddress = this.getWalletAddress();
            const canWrite = this.canWrite();

            if (!walletAddress) {
                this.runtime.logger.debug('ERC-8004: Skipping registration status check - no wallet configured');
                return;
            }

            this.runtime.logger.debug({
                walletAddress,
                canWrite,
                chainId: this.chainId,
                contractAddress: this.contractAddress,
            }, 'ERC-8004: Checking agent registration by wallet NFT...');

            // Method 1: Check by wallet address (ERC721 NFT detection - most reliable for Babylon-style registries)
            const walletCheck = await this.checkRegistrationByWallet(walletAddress);

            if (walletCheck.registered) {
                const registrationStatus = {
                    registered: true,
                    tokenId: walletCheck.tokenId?.toString() || null,
                    walletAddress,
                    canWrite,
                    agentInfo: walletCheck.agentInfo
                        ? {
                            name: walletCheck.agentInfo.name,
                            domain: walletCheck.agentInfo.domain,
                            active: walletCheck.agentInfo.active,
                            reputation: walletCheck.agentInfo.reputation.toString(),
                        }
                        : null,
                };
                this.runtime.logger.info(registrationStatus, '✅ ERC-8004: Agent is registered (detected via wallet NFT)');
                return;
            }

            // Method 2: Fall back to agentId-based lookup (for standard ERC-8004 contracts)
            const agentId = this.configuredAgentId || this.runtime.agentId;
            if (agentId) {
                const agentInfo = await this.getAgentInfo(agentId);
                if (agentInfo) {
                    const isActive = await this.isAgentActive(agentId);
                    const registrationStatus = {
                        registered: true,
                        active: isActive,
                        agentId,
                        walletAddress,
                        canWrite,
                        agentInfo: {
                            name: agentInfo.name,
                            domain: agentInfo.domain,
                            active: agentInfo.active,
                            reputation: agentInfo.reputation.toString(),
                            owner: agentInfo.owner,
                            lastUpdate: agentInfo.lastUpdate.toString(),
                        },
                    };
                    if (isActive) {
                        this.runtime.logger.info(registrationStatus, '✅ ERC-8004: Agent is registered and active');
                    } else {
                        this.runtime.logger.warn(registrationStatus, '⚠️  ERC-8004: Agent is registered but INACTIVE');
                    }
                    return;
                }
            }

            // Not registered by either method
            this.runtime.logger.warn({
                registered: false,
                walletAddress,
                agentId: agentId || null,
                canWrite,
            }, '⚠️  ERC-8004: Agent is NOT registered. Use REGISTER_AGENT_ERC8004 action to register.');
        } catch (error) {
            this.runtime.logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    errorStack: error instanceof Error ? error.stack : undefined,
                    agentId: this.runtime.agentId,
                    walletAddress: this.getWalletAddress(),
                    chainId: this.chainId,
                    contractAddress: this.contractAddress,
                },
                'ERC-8004: Error checking agent registration status'
            );
        }
    }

    //
    // MARK: Service Lifecycle
    //

    static async start(
        runtime: IAgentRuntime,
        configOptions?: ERC8004ConfigOptions
    ): Promise<ERC8004Service> {
        runtime.logger.info('Starting ERC8004Service');
        const service = new ERC8004Service(runtime, configOptions);
        await service.initialize();
        return service;
    }

    static async stop(runtime: IAgentRuntime): Promise<void> {
        runtime.logger.info('Stopping ERC8004Service');
        const service = runtime.getService(ERC8004Service.serviceType);
        if (service) {
            await service.stop();
        }
    }

    async stop(): Promise<void> {
        this.runtime.logger.info('ERC8004Service stopped');
        // Cleanup if needed
    }
}

