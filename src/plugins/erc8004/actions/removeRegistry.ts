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

/**
 * Interface representing the content of a remove registry request.
 */
interface RemoveRegistryContent extends Content {
    id: string;
}

/**
 * Checks if the given content is valid for removing a registry.
 */
function isRemoveRegistryContent(content: RemoveRegistryContent): boolean {
    return !!(content.id && typeof content.id === 'string');
}

const removeRegistryTemplate = `Respond with a JSON markdown block containing only the extracted values.

Example response:
\`\`\`json
{
    "id": "custom-registry-1"
}
\`\`\`

{{recentMessages}}

Extract the registry ID from the request to remove a registry.

Common patterns:
- "Remove registry custom-registry-1" → id: "custom-registry-1"
- "Delete registry my-registry" → id: "my-registry"
- "Remove the registry with ID test-registry" → id: "test-registry"

The ID field is required.

Respond with a JSON markdown block containing only the extracted values. Start your response immediately with \`\`\`json and end with \`\`\`.`;

export const removeRegistryAction: Action = {
    name: 'REMOVE_REGISTRY_ERC8004',
    similes: ['DELETE_REGISTRY_ERC8004', 'REMOVE_ERC8004_REGISTRY', 'DELETE_REPUTATION_REGISTRY'],
    description: 'Remove an ERC-8004 registry from the list (cannot remove default registries)',

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
        state: State | undefined,
        _options: any,
        callback?: HandlerCallback
    ): Promise<ActionResult> => {
        try {
            const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
            if (!service) {
                throw new Error('ERC8004Service not available');
            }

            // Compose prompt to extract registry ID from message
            logger.log('REMOVE_REGISTRY_ERC8004 Starting handler...');

            const removeRegistryPrompt = composePromptFromState({
                state: state || {} as State,
                template: removeRegistryTemplate,
            });

            // Use LLM to extract registry ID
            const llmResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: removeRegistryPrompt,
            });

            let content = parseJSONObjectFromText(llmResponse) as RemoveRegistryContent;

            logger.log('REMOVE_REGISTRY_ERC8004 extracted content:', content as any);

            // Validate extracted content
            if (!isRemoveRegistryContent(content)) {
                const errorMsg = 'Invalid registry ID. Please specify the registry ID to remove.';
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['REMOVE_REGISTRY_ERC8004'],
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

            // Check if registry exists
            const registry = await registryManager.getRegistry(content.id);
            if (!registry) {
                const errorMsg = `Registry with ID "${content.id}" not found.`;
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['REMOVE_REGISTRY_ERC8004'],
                        source: message.content.source,
                    });
                }
                return {
                    text: errorMsg,
                    success: false,
                    error: new Error(errorMsg),
                };
            }

            logger.info(`Removing registry: ${registry.name} (${content.id})`);

            const success = await registryManager.removeRegistry(content.id);

            if (success) {
                const response = `✅ Successfully removed ERC-8004 registry!

**Removed Registry:**
• ID: ${content.id}
• Name: ${registry.name}

The registry has been removed from the list.`;

                if (callback) {
                    await callback({
                        text: response,
                        actions: ['REMOVE_REGISTRY_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: response,
                    success: true,
                    data: {
                        removedId: content.id,
                    },
                };
            } else {
                const errorResponse = `❌ Failed to remove registry. The registry may be a default registry (which cannot be removed) or it may not exist.`;

                if (callback) {
                    await callback({
                        text: errorResponse,
                        actions: ['REMOVE_REGISTRY_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: errorResponse,
                    success: false,
                    error: new Error('Failed to remove registry'),
                };
            }
        } catch (error) {
            logger.error({ error }, 'Error in removeRegistry action:');
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorResponse = `❌ Failed to remove registry: ${errorMsg}`;

            if (callback) {
                await callback({
                    text: errorResponse,
                    actions: ['REMOVE_REGISTRY_ERC8004'],
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
                    text: 'Remove registry custom-registry-1',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll remove that registry from the list.",
                    actions: ['REMOVE_REGISTRY_ERC8004'],
                } as any,
            },
        ],
    ],
};

