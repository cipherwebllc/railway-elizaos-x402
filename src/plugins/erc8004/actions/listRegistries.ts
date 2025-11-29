import type {
    Action,
    ActionResult,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
} from '@elizaos/core';
import { logger } from '@elizaos/core';
import { ERC8004Service } from '../service';
import { ERC8004_SERVICE_NAME } from '../constants';

export const listRegistriesAction: Action = {
    name: 'LIST_REGISTRIES_ERC8004',
    similes: ['SHOW_REGISTRIES_ERC8004', 'LIST_ERC8004_REGISTRIES', 'SHOW_REPUTATION_REGISTRIES'],
    description: 'List all configured ERC-8004 registries',

    validate: async (runtime: IAgentRuntime, _message: Memory, _state: State | undefined): Promise<boolean> => {
        const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
        if (!service) {
            logger.warn('ERC8004Service not available');
            return false;
        }

        return true;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State | undefined,
        _options: any,
        callback?: HandlerCallback
    ): Promise<ActionResult> => {
        try {
            const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
            if (!service) {
                throw new Error('ERC8004Service not available');
            }

            const registryManager = service.getRegistryManager();
            const registries = await registryManager.getRegistries();

            if (registries.length === 0) {
                const response = `No ERC-8004 registries configured.

Use ADD_REGISTRY_ERC8004 to add a registry.`;

                if (callback) {
                    await callback({
                        text: response,
                        actions: ['LIST_REGISTRIES_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: response,
                    success: true,
                    data: {
                        registries: [],
                    },
                };
            }

            const defaultCount = registries.filter((r) => r.isDefault).length;
            const customCount = registries.length - defaultCount;

            let response = `**ERC-8004 Registries** (${registries.length} total: ${defaultCount} default, ${customCount} custom)\n\n`;

            for (const registry of registries) {
                response += `${registry.isDefault ? '🔵' : '⚪'} **${registry.name}**\n`;
                response += `   • ID: \`${registry.id}\`\n`;
                response += `   • Chain ID: ${registry.chainId}\n`;
                response += `   • Contract: \`${registry.contractAddress}\`\n`;
                if (registry.rpcUrl) {
                    response += `   • RPC URL: ${registry.rpcUrl}\n`;
                }
                response += `   • Type: ${registry.isDefault ? 'Default' : 'Custom'}\n\n`;
            }

            response += `Use ADD_REGISTRY_ERC8004 to add more registries.\n`;
            response += `Use REMOVE_REGISTRY_ERC8004 to remove custom registries.`;

            if (callback) {
                await callback({
                    text: response,
                    actions: ['LIST_REGISTRIES_ERC8004'],
                    source: message.content.source,
                });
            }

            return {
                text: response,
                success: true,
                data: {
                    registries,
                    count: registries.length,
                    defaultCount,
                    customCount,
                },
            };
        } catch (error) {
            logger.error({ error }, 'Error in listRegistries action:');
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorResponse = `❌ Failed to list registries: ${errorMsg}`;

            if (callback) {
                await callback({
                    text: errorResponse,
                    actions: ['LIST_REGISTRIES_ERC8004'],
                    source: message.content.source,
                });
            }

            return {
                text: errorResponse,
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    },

    examples: [
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'List all ERC-8004 registries',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll show you all configured registries.",
                    actions: ['LIST_REGISTRIES_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'What registries are configured?',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll list all the registries for you.",
                    actions: ['LIST_REGISTRIES_ERC8004'],
                } as any,
            },
        ],
    ],
};

