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
import type { RegistrationHandler } from '../types';

/**
 * Interface representing the content of an agent registration.
 */
interface RegisterAgentContent extends Content {
    agentId: string;
    name: string;
    domain: string;
    registryId?: string;
}

/**
 * Checks if the given registration content is valid.
 */
function isRegisterAgentContent(content: RegisterAgentContent): boolean {
    logger.log('Content for registration', JSON.stringify(content));

    if (!content.agentId || typeof content.agentId !== 'string') {
        console.warn('bad agentId');
        return false;
    }

    if (!content.name || typeof content.name !== 'string') {
        console.warn('bad name');
        return false;
    }

    if (!content.domain || typeof content.domain !== 'string') {
        console.warn('bad domain');
        return false;
    }

    console.log('registration content valid');
    return true;
}

/**
 * Template for determining the registration details.
 */
const registrationTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "agentId": "my-agent-123",
    "name": "My Agent",
    "domain": "example.com"
}
\`\`\`

{{recentMessages}}

Extract the following information about the requested agent registration:
- Agent ID (unique identifier for the agent)
- Agent name (display name for the agent)
- Domain (the domain or service the agent operates on)
- Registry ID (optional - which registry to register in, defaults to first available)

Common patterns:
- "Register agent my-bot with name MyBot on domain example.com" → agentId: "my-bot", name: "MyBot", domain: "example.com"
- "Create agent identity alice for AliceAI on discord.com" → agentId: "alice", name: "AliceAI", domain: "discord.com"
- "Register as bob-trader on trading.io" → agentId: "bob-trader", name: "Bob Trader", domain: "trading.io"

If the user doesn't specify all fields, use sensible defaults:
- If no domain is specified, use "eliza.os"
- If no name is specified, use a capitalized version of the agentId
- The agentId should be lowercase with hyphens

Respond with a JSON markdown block containing only the extracted values. All fields are required.

IMPORTANT: Your response must ONLY contain the json block above. Do not include any text, thinking, or reasoning before or after this JSON block. Start your response immediately with \`\`\`json and end with \`\`\`.`;

export const registerAgentAction: Action = {
    name: 'REGISTER_AGENT_ERC8004',
    similes: ['REGISTER_ON_CHAIN', 'CREATE_AGENT_IDENTITY', 'REGISTER_REPUTATION'],
    description: 'Register an agent in the ERC-8004 on-chain reputation system',

    validate: async (runtime: IAgentRuntime, _message: Memory, _state: State | undefined): Promise<boolean> => {
        const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
        if (!service) {
            logger.warn('ERC8004Service not available');
            return false;
        }

        if (!service.canWrite()) {
            service.warnReadOnlyMode();
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

            // Get the handler for the registry to determine required params
            // First, check if a specific registryId was requested
            let targetRegistry: any = null;
            let handler: RegistrationHandler | null = null;
            let contractAddress: string | null = null;

            // Try to get handler from service's default contract first (for prompt composition)
            const defaultContractAddress = service.getContract()?.target as string;
            if (defaultContractAddress) {
                handler = await service.getHandlerForAddress(defaultContractAddress);
                contractAddress = defaultContractAddress;
            }

            // Build dynamic prompt based on handler's required params
            let registrationTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
`;

            if (handler && handler.requiredParams) {
                const exampleParams: Record<string, any> = {};
                const paramDescriptions: string[] = [];

                for (const param of handler.requiredParams) {
                    if (param.name === 'agentId') {
                        exampleParams.agentId = 'my-agent-123';
                        paramDescriptions.push(`- Agent ID (${param.description})`);
                    } else if (param.name === 'name') {
                        exampleParams.name = 'My Agent';
                        paramDescriptions.push(`- Agent name (${param.description})`);
                    } else if (param.name === 'domain') {
                        exampleParams.domain = 'example.com';
                        paramDescriptions.push(`- Domain (${param.description})`);
                    } else {
                        exampleParams[param.name] = param.default || 'example-value';
                        paramDescriptions.push(`- ${param.name} (${param.description})${param.required ? ' - REQUIRED' : ' - optional'}`);
                    }
                }

                registrationTemplate += Object.entries(exampleParams)
                    .map(([key, value]) => `    "${key}": ${JSON.stringify(value)}`)
                    .join(',\n');
                registrationTemplate += `\n}\n\`\`\`\n\n{{recentMessages}}\n\nExtract the following information about the requested agent registration:\n`;
                registrationTemplate += paramDescriptions.join('\n');
                registrationTemplate += '\n- Registry ID (optional - which registry to register in, defaults to first available)\n';
                registrationTemplate += '  IMPORTANT: If a registry name is mentioned (e.g., "babylon", "Babylon"), you MUST use the EXACT registry ID from the list (e.g., "babylon-base-sepolia"). Do NOT use partial names or abbreviations. If unsure, use null.\n\n';
            } else {
                // Fallback to standard template
                registrationTemplate += `    "agentId": "my-agent-123",
    "name": "My Agent",
    "domain": "example.com"
}
\`\`\`

{{recentMessages}}

Extract the following information about the requested agent registration:
- Agent ID (unique identifier for the agent)
- Agent name (display name for the agent)
- Domain (the domain or service the agent operates on)
- Registry ID (optional - which registry to register in, defaults to first available)
  IMPORTANT: If a registry name is mentioned (e.g., "babylon", "Babylon"), you MUST use the EXACT registry ID from the list (e.g., "babylon-base-sepolia"). Do NOT use partial names or abbreviations. If unsure, use null.

`;
            }

            registrationTemplate += `Common patterns:
- "Register agent my-bot with name MyBot on domain example.com" → agentId: "my-bot", name: "MyBot", domain: "example.com"
- "Create agent identity alice for AliceAI on discord.com" → agentId: "alice", name: "AliceAI", domain: "discord.com"
- "Register as bob-trader on trading.io" → agentId: "bob-trader", name: "Bob Trader", domain: "trading.io"
- "Register on Babylon" or "Register on babylon-base-sepolia" → registryId: "babylon-base-sepolia" (use EXACT ID from registry list)

Registry ID rules:
- If user mentions a registry name (e.g., "Babylon", "babylon"), look for the EXACT registry ID in recent messages or use LIST_REGISTRIES_ERC8004 to find it
- Common registry IDs: "babylon-base-sepolia" for Babylon on Base Sepolia
- If the exact registry ID cannot be determined, use null (not a partial name)
- NEVER use partial names like "babylon" - always use the full ID like "babylon-base-sepolia"

If the user doesn't specify all fields, use sensible defaults:
- If no domain is specified, use "eliza.os"
- If no name is specified, use a capitalized version of the agentId
- The agentId should be lowercase with hyphens

Respond with a JSON markdown block containing only the extracted values. All required fields must be present.

IMPORTANT: Your response must ONLY contain the json block above. Do not include any text, thinking, or reasoning before or after this JSON block. Start your response immediately with \`\`\`json and end with \`\`\`.`;

            // Compose prompt to extract registration details from message
            logger.log('REGISTER_AGENT_ERC8004 Starting handler...');

            const registrationPrompt = composePromptFromState({
                state: state || {} as State,
                template: registrationTemplate,
            });

            // Use LLM to extract registration details
            const llmResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: registrationPrompt,
            });

            let content = parseJSONObjectFromText(llmResponse) as any;

            logger.log('REGISTER_AGENT_ERC8004 extracted content:', content as any);

            // Normalize null values - handle string "null" and actual null
            Object.keys(content).forEach(key => {
                const value = content[key];
                if (value === null || value === 'null' || value === '') {
                    delete content[key];
                }
            });

            // Apply defaults based on handler requirements
            if (handler && handler.requiredParams) {
                for (const param of handler.requiredParams) {
                    if (!content[param.name] && param.default) {
                        content[param.name] = param.default;
                    }
                }
            }

            // Apply standard defaults if not specified
            if (!content.agentId) {
                content.agentId = runtime.agentId;
            }
            if (!content.name) {
                content.name = runtime.character?.name || content.agentId;
            }
            if (!content.domain) {
                content.domain = 'eliza.os';
            }

            // Validate required params if handler has validation
            if (handler?.validate && !handler.validate(content)) {
                const errorMsg = 'Invalid registration parameters provided. Please check all required fields.';
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['REGISTER_AGENT_ERC8004'],
                        source: message.content.source,
                    });
                }
                return {
                    text: errorMsg,
                    success: false,
                    error: new Error(errorMsg),
                };
            }

            // Basic validation for standard params
            if (!content.agentId || !content.name || !content.domain) {
                const errorMsg = 'Invalid registration parameters provided. Please specify the agent ID, name, and domain.';
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['REGISTER_AGENT_ERC8004'],
                        source: message.content.source,
                    });
                }
                return {
                    text: errorMsg,
                    success: false,
                    error: new Error(errorMsg),
                };
            }

            let { agentId, name, domain, registryId } = content;

            // If registryId is specified, get that registry and its handler
            if (registryId) {
                const registryManager = service.getRegistryManager();
                targetRegistry = await registryManager.getRegistry(registryId);
                if (!targetRegistry) {
                    const errorMsg = `Registry "${registryId}" not found. Use LIST_REGISTRIES_ERC8004 to see available registries.`;
                    if (callback) {
                        await callback({
                            text: errorMsg,
                            actions: ['REGISTER_AGENT_ERC8004'],
                            source: message.content.source,
                        });
                    }
                    return {
                        text: errorMsg,
                        success: false,
                        error: new Error(errorMsg),
                    };
                }

                // Get handler for the specific registry's contract address
                handler = await service.getHandlerForAddress(targetRegistry.contractAddress);
                contractAddress = targetRegistry.contractAddress;

                logger.info(`Found handler for registry ${registryId}: type=${handler?.type || 'none'}, contractAddress=${contractAddress}`);

                // If handler requires different params than what we extracted, re-extract with correct prompt
                if (handler && handler.requiredParams) {
                    const extractedParams = Object.keys(content);
                    const requiredParamNames = handler.requiredParams
                        .filter(p => p.required)
                        .map(p => p.name);
                    const missingParams = requiredParamNames.filter(p => !extractedParams.includes(p));

                    if (missingParams.length > 0) {
                        // Build handler-specific prompt
                        let handlerTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
`;

                        const exampleParams: Record<string, any> = {};
                        const paramDescriptions: string[] = [];

                        for (const param of handler.requiredParams) {
                            if (param.name === 'name') {
                                exampleParams.name = name || 'My Agent';
                                paramDescriptions.push(`- ${param.name} (${param.description})${param.required ? ' - REQUIRED' : ' - optional'}`);
                            } else if (param.name === 'a2aEndpoint') {
                                exampleParams.a2aEndpoint = 'wss://my-agent.com/a2a';
                                paramDescriptions.push(`- ${param.name} (${param.description})${param.required ? ' - REQUIRED' : ' - optional'}`);
                            } else if (param.name === 'capabilities') {
                                exampleParams.capabilities = {};
                                paramDescriptions.push(`- ${param.name} (${param.description})${param.required ? ' - REQUIRED' : ' - optional'}`);
                            } else {
                                exampleParams[param.name] = param.default || 'example-value';
                                paramDescriptions.push(`- ${param.name} (${param.description})${param.required ? ' - REQUIRED' : ' - optional'}`);
                            }
                        }

                        handlerTemplate += Object.entries(exampleParams)
                            .map(([key, value]) => `    "${key}": ${JSON.stringify(value)}`)
                            .join(',\n');
                        handlerTemplate += `\n}\n\`\`\`\n\n{{recentMessages}}\n\nExtract the following information for ${targetRegistry.name} registry registration:\n`;
                        handlerTemplate += paramDescriptions.join('\n');
                        handlerTemplate += `\n\nYou already have: agentId="${agentId}", name="${name}", domain="${domain}". Extract any missing required fields.\n\nRespond with a JSON markdown block containing only the extracted values. All required fields must be present.`;

                        // Re-extract with handler-specific prompt
                        const handlerPrompt = composePromptFromState({
                            state: state || {} as State,
                            template: handlerTemplate,
                        });

                        const handlerResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
                            prompt: handlerPrompt,
                        });

                        const handlerContent = parseJSONObjectFromText(handlerResponse) as any;

                        // Normalize null values in handler content
                        Object.keys(handlerContent).forEach(key => {
                            if (handlerContent[key] === null || handlerContent[key] === 'null' || handlerContent[key] === '') {
                                delete handlerContent[key];
                            }
                        });

                        // Merge extracted content
                        content = { ...content, ...handlerContent };
                        agentId = content.agentId || agentId;
                        name = content.name || name;
                        domain = content.domain || domain;
                    }
                }
            }

            logger.info(`Registering agent ${agentId} with name ${name} on domain ${domain}${registryId ? ` in registry ${registryId}` : ''}`);
            logger.debug(`Using handler: type=${handler?.type || 'none'}, contractAddress=${contractAddress || 'none'}, content keys=${Object.keys(content).join(',')}`);

            // Use handler to register if available, otherwise fall back to service method
            let result;
            if (handler && contractAddress) {
                // Use handler directly with the target registry's contract address
                logger.debug(`Calling handler.register() with params: ${JSON.stringify(Object.keys(content))}`);
                result = await handler.register(runtime, content);
            } else {
                logger.warn(`No handler found, falling back to service.registerAgent() - handler=${handler ? 'exists' : 'null'}, contractAddress=${contractAddress || 'null'}`);
                // Fallback to service method (backward compatible)
                result = await service.registerAgent({
                    agentId,
                    name,
                    domain,
                });
            }

            if (result.success) {
                const response = `✅ Successfully registered agent on-chain!

🆔 **Agent Details:**
• ID: ${agentId}
• Name: ${name}
• Domain: ${domain}

🔗 **Transaction:**
• TX Hash: \`${result.transactionHash}\`
• View on BaseScan: https://sepolia.basescan.org/tx/${result.transactionHash}`;

                if (callback) {
                    await callback({
                        text: response,
                        actions: ['REGISTER_AGENT_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: response,
                    success: true,
                    data: {
                        transactionHash: result.transactionHash,
                        agentId,
                        name,
                        domain,
                    },
                };
            } else {
                const errorResponse = `❌ Failed to register agent ${agentId}: ${result.error}`;

                if (callback) {
                    await callback({
                        text: errorResponse,
                        actions: ['REGISTER_AGENT_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: errorResponse,
                    success: false,
                    error: new Error(result.error),
                };
            }
        } catch (error) {
            logger.error({ error }, 'Error in registerAgent action:');
            return {
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
                    text: 'Register agent my-bot with name MyBot on domain example.com',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll register my-bot on the blockchain for you",
                    actions: ['REGISTER_AGENT_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'Create agent identity alice for AliceAI on discord.com',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll create the on-chain identity for alice",
                    actions: ['REGISTER_AGENT_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'Register me on the blockchain',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll register your on-chain identity",
                    actions: ['REGISTER_AGENT_ERC8004'],
                } as any,
            },
        ],
    ],
};

