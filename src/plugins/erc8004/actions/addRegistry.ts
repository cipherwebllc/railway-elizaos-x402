import type {
    Action,
    ActionResult,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
    Content,
} from '@elizaos/core';
import {
    logger,
    composePromptFromState,
    ModelType,
    parseJSONObjectFromText,
} from '@elizaos/core';
import { ERC8004Service } from '../service';
import { ERC8004_SERVICE_NAME } from '../constants';
import type { ERC8004Registry } from '../types';

/**
 * Interface representing the content of an add registry request.
 */
interface AddRegistryContent extends Content {
    id: string;
    name: string;
    chainId: number;
    contractAddress: string;
    rpcUrl?: string;
}

/**
 * Checks if the given content is valid for adding a registry.
 */
function isAddRegistryContent(content: AddRegistryContent): boolean {
    if (!content.id || typeof content.id !== 'string') {
        return false;
    }

    if (!content.name || typeof content.name !== 'string') {
        return false;
    }

    if (!content.chainId || typeof content.chainId !== 'number') {
        return false;
    }

    if (!content.contractAddress || typeof content.contractAddress !== 'string') {
        return false;
    }

    // Validate contract address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(content.contractAddress)) {
        return false;
    }

    return true;
}

const addRegistryTemplate = `Respond with a JSON markdown block containing only the extracted values.

Example response:
\`\`\`json
{
    "id": "custom-registry-1",
    "name": "Custom Registry",
    "chainId": 84532,
    "contractAddress": "0x4102F9b209796b53a18B063A438D05C7C9Af31A2",
    "rpcUrl": "https://sepolia.base.org"
}
\`\`\`

{{recentMessages}}

Extract the following information about the requested ERC-8004 registry:
- ID (unique identifier, e.g., "custom-registry-1")
- Name (display name, e.g., "Custom Registry")
- Chain ID (numeric chain ID, e.g., 84532 for Base Sepolia)
- Contract Address (0x followed by 40 hex characters)
- RPC URL (optional, WebSocket or HTTP URL for the chain)

Common patterns:
- "Add registry custom-registry-1 on Base Sepolia at 0x..." → id: "custom-registry-1", chainId: 84532, contractAddress: "0x..."
- "Register new ERC-8004 registry MyRegistry on chain 1" → id: "my-registry", name: "MyRegistry", chainId: 1

All fields except rpcUrl are required. The contract address must be a valid Ethereum address (0x followed by 40 hex characters).

Respond with a JSON markdown block containing only the extracted values. Start your response immediately with \`\`\`json and end with \`\`\`.`;

export const addRegistryAction: Action = {
    name: 'ADD_REGISTRY_ERC8004',
    similes: ['ADD_ERC8004_REGISTRY', 'REGISTER_NEW_REGISTRY', 'ADD_REPUTATION_REGISTRY'],
    description: 'Add a new ERC-8004 registry to the list of monitored registries',

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined): Promise<boolean> => {
        // Only validate if message mentions registry-related keywords
        const text = (message.content?.text || '').toLowerCase();
        const hasRegistryKeyword =
            text.includes('add registry') ||
            text.includes('add erc8004') ||
            text.includes('add erc-8004') ||
            text.includes('new registry') ||
            text.includes('register registry') ||
            text.includes('レジストリ追加');

        if (!hasRegistryKeyword) {
            return false;
        }

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
        state: State | undefined,
        _options: any,
        callback?: HandlerCallback
    ): Promise<ActionResult> => {
        try {
            const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
            if (!service) {
                throw new Error('ERC8004Service not available');
            }

            // Compose prompt to extract registry details from message
            logger.log('ADD_REGISTRY_ERC8004 Starting handler...');

            const addRegistryPrompt = composePromptFromState({
                state: state || {} as State,
                template: addRegistryTemplate,
            });

            // Use LLM to extract registry details
            const llmResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: addRegistryPrompt,
            });

            let content = parseJSONObjectFromText(llmResponse) as AddRegistryContent;

            logger.log('ADD_REGISTRY_ERC8004 extracted content:', content as any);

            // Validate extracted content
            if (!isAddRegistryContent(content)) {
                const errorMsg = 'Invalid registry parameters. Please specify: id, name, chainId, and contractAddress.';
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['ADD_REGISTRY_ERC8004'],
                        source: message.content.source,
                    });
                }
                return {
                    text: errorMsg,
                    success: false,
                    error: new Error(errorMsg),
                };
            }

            const registryManager = service.getRegistryManager();

            // Check if registry already exists
            const existing = await registryManager.getRegistry(content.id);
            if (existing) {
                const errorMsg = `Registry with ID "${content.id}" already exists. Use a different ID.`;
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['ADD_REGISTRY_ERC8004'],
                        source: message.content.source,
                    });
                }
                return {
                    text: errorMsg,
                    success: false,
                    error: new Error(errorMsg),
                };
            }

            const registry: ERC8004Registry = {
                id: content.id,
                name: content.name,
                chainId: content.chainId,
                contractAddress: content.contractAddress,
                rpcUrl: content.rpcUrl,
                isDefault: false,
            };

            logger.info(`Adding registry: ${registry.name} (${registry.id})`);

            const success = await registryManager.addRegistry(registry);

            if (success) {
                const response = `✅ Successfully added ERC-8004 registry!

**Registry Details:**
• ID: ${registry.id}
• Name: ${registry.name}
• Chain ID: ${registry.chainId}
• Contract: \`${registry.contractAddress}\`
• RPC URL: ${registry.rpcUrl || 'Using default'}

The registry is now available for agent registration checks.`;

                if (callback) {
                    await callback({
                        text: response,
                        actions: ['ADD_REGISTRY_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: response,
                    success: true,
                    data: {
                        registry,
                    },
                };
            } else {
                const errorResponse = `❌ Failed to add registry. The registry ID may already exist or the contract address format is invalid.`;

                if (callback) {
                    await callback({
                        text: errorResponse,
                        actions: ['ADD_REGISTRY_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: errorResponse,
                    success: false,
                    error: new Error('Failed to add registry'),
                };
            }
        } catch (error) {
            logger.error({ error }, 'Error in addRegistry action:');
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorResponse = `❌ Failed to add registry: ${errorMsg}`;

            if (callback) {
                await callback({
                    text: errorResponse,
                    actions: ['ADD_REGISTRY_ERC8004'],
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
                    text: 'Add a new ERC-8004 registry',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll help you add a new ERC-8004 registry. Please provide: registry ID, name, chain ID, and contract address.",
                    actions: ['ADD_REGISTRY_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'Add registry custom-registry-1 on Base Sepolia at 0x4102F9b209796b53a18B063A438D05C7C9Af31A2',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll add the custom registry to the list.",
                    actions: ['ADD_REGISTRY_ERC8004'],
                } as any,
            },
        ],
    ],
};

