import { z } from 'zod';
import type { IAgentRuntime } from '@elizaos/core';
import { SUPPORTED_CHAINS } from './constants';
import { ChainId } from './types';

const ERC8004SettingsSchema = z.object({
    ERC8004_RPC_URL: z
        .string()
        .url()
        .optional()
        .nullable()
        .transform((val) => val || undefined),
    ERC8004_CHAIN_ID: z
        .string()
        .optional()
        .nullable()
        .transform((val) => (val ? parseInt(val, 10) : undefined))
        .refine(
            (val) => val === undefined || Object.values(SUPPORTED_CHAINS).includes(val as ChainId),
            'Chain ID must be a supported chain'
        ),
    ERC8004_CONTRACT_ADDRESS: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format')
        .optional()
        .nullable()
        .transform((val) => val || undefined),
    ERC8004_PRIVATE_KEY: z
        .preprocess((val) => {
            // Handle undefined, null, or empty values
            if (!val || typeof val !== 'string') return undefined;
            // Trim whitespace
            const trimmed = val.trim();
            if (trimmed.length === 0) return undefined;
            // Normalize: ensure 0x prefix
            return trimmed.startsWith('0x') ? trimmed : '0x' + trimmed;
        }, z
            .string()
            .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key format - must be 64 hex characters (0x prefix will be added if missing)')
            .optional()),
    ERC8004_AGENT_ID: z
        .string()
        .optional()
        .nullable()
        .transform((val) => val || undefined),
});

export type ERC8004Settings = z.infer<typeof ERC8004SettingsSchema>;

/**
 * Configuration options that can be passed directly or loaded from runtime
 */
export interface ERC8004ConfigOptions {
    contractAddress?: string;
    chainId?: number;
    rpcUrl?: string;
    privateKey?: string;
    agentId?: string;
}

export async function validateERC8004Config(
    runtime: IAgentRuntime,
    options?: ERC8004ConfigOptions
): Promise<ERC8004Settings> {
    try {
        // Priority: options > ERC8004_* settings > alternative setting names > plugin-evm fallback

        // Contract Address: options > ERC8004_CONTRACT_ADDRESS setting > first registry from RegistryManager > undefined
        let contractAddress =
            options?.contractAddress ||
            runtime.getSetting('ERC8004_CONTRACT_ADDRESS') ||
            undefined;

        // If no explicit address, try to get from RegistryManager (allows plugins to register their registries)
        if (!contractAddress) {
            try {
                // Import RegistryManager dynamically to avoid circular dependencies
                const { RegistryManager } = await import('./registry-manager');
                const registryManager = new RegistryManager(runtime);
                const registries = await registryManager.getRegistries();

                // Use the first default registry, or first registry if no defaults
                const defaultRegistry = registries.find((r) => r.isDefault) || registries[0];
                if (defaultRegistry?.contractAddress) {
                    contractAddress = defaultRegistry.contractAddress;
                    runtime.logger?.debug(
                        `ERC-8004: Using contract address from registry: ${defaultRegistry.name} (${defaultRegistry.id})`
                    );
                }
            } catch (error) {
                // RegistryManager not available or error - continue without it
                runtime.logger?.debug('ERC-8004: Could not load registries from RegistryManager');
            }
        }

        // Chain ID: options > ERC8004_CHAIN_ID setting > from registry > undefined
        let chainId =
            options?.chainId?.toString() ||
            runtime.getSetting('ERC8004_CHAIN_ID') ||
            undefined;

        // RPC URL: options > ERC8004_RPC_URL setting > EVM_PROVIDER_URL (plugin-evm) > from registry > undefined
        let rpcUrl =
            options?.rpcUrl ||
            runtime.getSetting('ERC8004_RPC_URL') ||
            undefined;

        // Private Key: options > ERC8004_PRIVATE_KEY setting > EVM_PRIVATE_KEY (plugin-evm) > undefined
        let privateKey =
            options?.privateKey ||
            runtime.getSetting('ERC8004_PRIVATE_KEY') ||
            undefined;

        // If we got contract address from registry, also try to get chainId and rpcUrl from same registry
        if (contractAddress && (!chainId || !rpcUrl)) {
            try {
                const { RegistryManager } = await import('./registry-manager');
                const registryManager = new RegistryManager(runtime);
                const registries = await registryManager.getRegistries();
                const registry = registries.find((r) => r.contractAddress === contractAddress);

                if (registry) {
                    if (!chainId && registry.chainId) {
                        chainId = registry.chainId.toString();
                    }
                    if (!rpcUrl && registry.rpcUrl) {
                        rpcUrl = registry.rpcUrl;
                    }
                }
            } catch (error) {
                // Ignore errors - we'll use what we have
            }
        }

        // Explicit plugin-evm fallback with logging
        if (!rpcUrl || !privateKey) {
            const evmRpcUrl = runtime.getSetting('EVM_PROVIDER_URL');
            const evmPrivateKey = runtime.getSetting('EVM_PRIVATE_KEY');

            if (!rpcUrl && evmRpcUrl) {
                rpcUrl = evmRpcUrl;
            }
            if (!privateKey && evmPrivateKey) {
                privateKey = evmPrivateKey;
                runtime.logger?.debug({
                    keyLength: evmPrivateKey?.length,
                    keyPrefix: evmPrivateKey?.substring(0, 4),
                    has0x: evmPrivateKey?.startsWith('0x'),
                }, 'ERC-8004: Using EVM_PRIVATE_KEY as fallback for private key');
            }

            // Log when using plugin-evm fallback
            if ((rpcUrl === evmRpcUrl || privateKey === evmPrivateKey) && (evmRpcUrl || evmPrivateKey)) {
                runtime.logger?.info('ERC-8004: Using plugin-evm settings as fallback for wallet configuration');
            }
        }

        // Agent ID priority: options > ERC8004_AGENT_ID > BABYLON_AGENT_ID > character.name > runtime.agentId
        let agentId =
            options?.agentId ||
            runtime.getSetting('ERC8004_AGENT_ID') ||
            runtime.getSetting('BABYLON_AGENT_ID') ||
            undefined;

        // If no explicit agent ID, derive from character name (normalized to lowercase with hyphens)
        if (!agentId && runtime.character?.name) {
            agentId = runtime.character.name.toLowerCase().replace(/\s+/g, '-');
        }

        // Final fallback to runtime.agentId (UUID)
        if (!agentId) {
            agentId = runtime.agentId;
        }

        const settings = {
            ERC8004_RPC_URL: rpcUrl,
            ERC8004_CHAIN_ID: chainId,
            ERC8004_CONTRACT_ADDRESS: contractAddress,
            ERC8004_PRIVATE_KEY: privateKey,
            ERC8004_AGENT_ID: agentId,
        };

        // Debug log before validation
        runtime.logger?.debug({
            hasPrivateKey: !!privateKey,
            privateKeyLength: privateKey?.length,
            privateKeyPrefix: privateKey?.substring(0, 4),
        }, 'ERC-8004: Settings before Zod validation');

        const validatedConfig = await ERC8004SettingsSchema.parseAsync(settings);

        // Debug log after validation
        runtime.logger?.debug({
            hasPrivateKey: !!validatedConfig.ERC8004_PRIVATE_KEY,
            privateKeyLength: validatedConfig.ERC8004_PRIVATE_KEY?.length,
            privateKeyPrefix: validatedConfig.ERC8004_PRIVATE_KEY?.substring(0, 4),
        }, 'ERC-8004: Settings after Zod validation');

        return validatedConfig;
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
            throw new Error(`ERC-8004 configuration validation failed: ${errorMessages}`);
        }
        throw error;
    }
}

