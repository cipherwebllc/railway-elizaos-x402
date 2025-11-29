import type { IAgentRuntime, Plugin } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { ERC8004Service } from './service';
import { ERC8004_SERVICE_NAME } from './constants';
import { registerAgentAction } from './actions/registerAgent';
import { checkReputationAction } from './actions/checkReputation';
import { endorseAgentAction } from './actions/endorseAgent';
import { penalizeAgentAction } from './actions/penalizeAgent';
import { addRegistryAction } from './actions/addRegistry';
import { removeRegistryAction } from './actions/removeRegistry';
import { listRegistriesAction } from './actions/listRegistries';
import { reputationProvider } from './providers/reputationProvider';
import { registrationStatusProvider } from './providers/registrationStatusProvider';
import type { ERC8004ConfigOptions } from './environment';

export const erc8004Plugin: Plugin = {
    name: ERC8004_SERVICE_NAME,
    description: 'ERC-8004 on-chain reputation and identity system for autonomous agents',

    actions: [
        registerAgentAction,
        checkReputationAction,
        endorseAgentAction,
        penalizeAgentAction,
        addRegistryAction,
        removeRegistryAction,
        listRegistriesAction,
    ],

    evaluators: [],

    providers: [reputationProvider, registrationStatusProvider],

    services: [ERC8004Service],

    init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
        logger.info('Initializing ERC-8004 plugin');

        // Don't block init waiting for services - the service will be registered by the runtime
        // after all plugins finish initializing. Services wait for initPromise to resolve,
        // so we can't wait for them here without causing a deadlock.

        // The service is defined in the services array and will be registered automatically
        // by the runtime after init completes. No need to wait for it here.

        logger.info('ERC-8004 plugin initialized - service will be available after runtime initialization completes');
    },
};

// Export all types and classes for external use
export * from './types';
export * from './constants';
export * from './service';
export * from './environment';
export * from './registry-manager';
export {
    registerAgentAction,
    checkReputationAction,
    endorseAgentAction,
    penalizeAgentAction,
    addRegistryAction,
    removeRegistryAction,
    listRegistriesAction,
};
export { reputationProvider, registrationStatusProvider };
export type { ERC8004ConfigOptions } from './environment';

/**
 * Helper function for plugins to register their ERC-8004 registries
 * This allows other plugins (like Babylon) to register their registries during init
 * 
 * @example
 * ```typescript
 * import { registerERC8004Registry } from '@elizaos/plugin-8004';
 * 
 * init: async (config, runtime) => {
 *   await registerERC8004Registry(runtime, {
 *     id: 'my-plugin-registry',
 *     name: 'My Plugin Registry',
 *     chainId: 84532,
 *     contractAddress: '0x...',
 *     rpcUrl: 'https://...',
 *     isDefault: true, // Set as default if no ERC8004_CONTRACT_ADDRESS is set
 *   });
 * }
 * ```
 */
export async function registerERC8004Registry(
    runtime: IAgentRuntime,
    registry: {
        id: string;
        name: string;
        chainId: number;
        contractAddress: string;
        rpcUrl?: string;
        isDefault?: boolean;
    }
): Promise<boolean> {
    try {
        const { RegistryManager } = await import('./registry-manager');
        const registryManager = new RegistryManager(runtime);
        return await registryManager.addRegistry({
            ...registry,
            isDefault: registry.isDefault ?? false,
        });
    } catch (error) {
        logger.error({ error }, `Failed to register ERC-8004 registry: ${registry.id}`);
        return false;
    }
}

export default erc8004Plugin;

