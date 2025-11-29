import type { IAgentRuntime } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { CACHE_KEYS, DEFAULT_REGISTRIES } from './constants';
import type { ERC8004Registry } from './types';

/**
 * RegistryManager - Manages ERC-8004 registry configurations
 * 
 * Stores registries globally in the cache table under key `erc8004:global:registries`.
 * Supports default registries and importing from settings.
 */
export class RegistryManager {
    private runtime: IAgentRuntime;
    private cacheKey = CACHE_KEYS.GLOBAL_REGISTRIES;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    /**
     * Get all registries from cache
     */
    async getRegistries(): Promise<ERC8004Registry[]> {
        try {
            const cached = await this.runtime.getCache<ERC8004Registry[]>(this.cacheKey);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                return cached;
            }
            // If no registries in cache, initialize defaults
            return await this.initializeDefaults();
        } catch (error) {
            logger.error({ error }, 'Error getting registries from cache');
            // Fallback to defaults
            return await this.initializeDefaults();
        }
    }

    /**
     * Get a single registry by ID
     */
    async getRegistry(id: string): Promise<ERC8004Registry | null> {
        const registries = await this.getRegistries();
        return registries.find((r) => r.id === id) || null;
    }

    /**
     * Add a registry to the list
     */
    async addRegistry(registry: ERC8004Registry): Promise<boolean> {
        try {
            const registries = await this.getRegistries();
            
            // Check if registry with this ID already exists
            const existingIndex = registries.findIndex((r) => r.id === registry.id);
            if (existingIndex !== -1) {
                const existing = registries[existingIndex];
                // Update existing registry if handlerType is provided and different/missing
                if (registry.handlerType && existing.handlerType !== registry.handlerType) {
                    registries[existingIndex] = { ...existing, handlerType: registry.handlerType };
                    await this.runtime.setCache(this.cacheKey, registries);
                    logger.info(`Updated registry: ${registry.name} (${registry.id}) with handlerType: ${registry.handlerType}`);
                    return true;
                }
                logger.debug(`Registry with ID ${registry.id} already exists with handlerType: ${existing.handlerType || 'standard'}`);
                return false;
            }

            // Validate contract address format
            if (!/^0x[a-fA-F0-9]{40}$/.test(registry.contractAddress)) {
                logger.error(`Invalid contract address format: ${registry.contractAddress}`);
                return false;
            }

            registries.push(registry);
            await this.runtime.setCache(this.cacheKey, registries);
            logger.info(`Added registry: ${registry.name} (${registry.id})`);
            return true;
        } catch (error) {
            logger.error({ error }, `Error adding registry ${registry.id}`);
            return false;
        }
    }

    /**
     * Remove a registry (only non-default registries can be removed)
     */
    async removeRegistry(id: string): Promise<boolean> {
        try {
            const registries = await this.getRegistries();
            const registry = registries.find((r) => r.id === id);

            if (!registry) {
                logger.warn(`Registry with ID ${id} not found`);
                return false;
            }

            if (registry.isDefault) {
                logger.warn(`Cannot remove default registry: ${id}`);
                return false;
            }

            const filtered = registries.filter((r) => r.id !== id);
            await this.runtime.setCache(this.cacheKey, filtered);
            logger.info(`Removed registry: ${registry.name} (${id})`);
            return true;
        } catch (error) {
            logger.error({ error }, `Error removing registry ${id}`);
            return false;
        }
    }

    /**
     * Initialize default registries and import from settings
     */
    async initializeDefaults(): Promise<ERC8004Registry[]> {
        try {
            // Start with default registries
            const registries: ERC8004Registry[] = [...DEFAULT_REGISTRIES];

            // Import from settings if available
            const settingsRegistries = this.runtime.getSetting('ERC8004_REGISTRIES');
            if (settingsRegistries) {
                try {
                    const parsed = typeof settingsRegistries === 'string' 
                        ? JSON.parse(settingsRegistries) 
                        : settingsRegistries;

                    if (Array.isArray(parsed)) {
                        for (const reg of parsed) {
                            // Validate registry structure
                            if (
                                reg.id &&
                                reg.name &&
                                reg.chainId &&
                                reg.contractAddress &&
                                /^0x[a-fA-F0-9]{40}$/.test(reg.contractAddress)
                            ) {
                                // Check if already exists (by ID)
                                if (!registries.some((r) => r.id === reg.id)) {
                                    registries.push({
                                        id: reg.id,
                                        name: reg.name,
                                        chainId: Number(reg.chainId),
                                        contractAddress: reg.contractAddress,
                                        rpcUrl: reg.rpcUrl,
                                        isDefault: reg.isDefault || false,
                                    });
                                }
                            } else {
                                logger.warn('Invalid registry format in ERC8004_REGISTRIES setting', reg);
                            }
                        }
                    }
                } catch (parseError) {
                    logger.error({ error: parseError }, 'Error parsing ERC8004_REGISTRIES setting');
                }
            }

            // Save to cache
            await this.runtime.setCache(this.cacheKey, registries);
            logger.info(`Initialized ${registries.length} registries (${registries.filter((r) => r.isDefault).length} default)`);
            
            return registries;
        } catch (error) {
            logger.error({ error }, 'Error initializing default registries');
            // Return defaults even if cache fails
            return [...DEFAULT_REGISTRIES];
        }
    }
}

