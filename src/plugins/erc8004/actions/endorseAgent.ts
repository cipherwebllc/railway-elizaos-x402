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
 * Interface representing the content of an endorsement.
 */
interface EndorseAgentContent extends Content {
    targetAgentId: string;
    amount: number | string;
}

/**
 * Checks if the given endorsement content is valid.
 */
function isEndorseAgentContent(content: EndorseAgentContent): boolean {
    logger.log('Content for endorsement', JSON.stringify(content));

    if (!content.targetAgentId || typeof content.targetAgentId !== 'string') {
        console.warn('bad targetAgentId');
        return false;
    }

    if (!content.amount || (typeof content.amount !== 'string' && typeof content.amount !== 'number')) {
        console.warn('bad amount', typeof content.amount, content.amount);
        return false;
    }

    console.log('endorsement content valid');
    return true;
}

/**
 * Template for determining the endorsement details.
 */
const endorsementTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "targetAgentId": "agent-abc-123",
    "amount": 10
}
\`\`\`

{{recentMessages}}

Extract the following information about the requested agent endorsement:
- Target agent ID (the agent being endorsed)
- Amount of reputation points to endorse (default to 10 if not specified)

Common patterns:
- "Endorse agent-123" → targetAgentId: "agent-123", amount: 10
- "Vouch for alice with 50 points" → targetAgentId: "alice", amount: 50
- "Increase reputation for bob by 25" → targetAgentId: "bob", amount: 25

Respond with a JSON markdown block containing only the extracted values. All fields are required.

IMPORTANT: Your response must ONLY contain the json block above. Do not include any text, thinking, or reasoning before or after this JSON block. Start your response immediately with \`\`\`json and end with \`\`\`.`;

export const endorseAgentAction: Action = {
    name: 'ENDORSE_AGENT_ERC8004',
    similes: ['ENDORSE_AGENT', 'INCREASE_REPUTATION', 'VOUCH_FOR_AGENT'],
    description: 'Endorse another agent to increase their reputation in the ERC-8004 system',

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

            // Compose prompt to extract endorsement details from message
            logger.log('ENDORSE_AGENT_ERC8004 Starting handler...');

            const endorsementPrompt = composePromptFromState({
                state: state || {} as State,
                template: endorsementTemplate,
            });

            // Use LLM to extract endorsement details
            const llmResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: endorsementPrompt,
            });

            const content = parseJSONObjectFromText(llmResponse) as EndorseAgentContent;

            logger.log('ENDORSE_AGENT_ERC8004 extracted content:', content as any);

            // Validate extracted content
            if (!isEndorseAgentContent(content)) {
                const errorMsg = 'Invalid endorsement parameters provided. Please specify the agent ID and optionally the amount.';
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['ENDORSE_AGENT_ERC8004'],
                        source: message.content.source,
                    });
                }
                return {
                    text: errorMsg,
                    success: false,
                    error: new Error(errorMsg),
                };
            }

            const targetAgentId = content.targetAgentId;
            const amount = BigInt(Number(content.amount));

            logger.info(`Endorsing agent ${targetAgentId} with amount ${amount}`);

            const result = await service.endorseAgent({
                agentId: targetAgentId,
                amount,
            });

            if (result.success) {
                const response = `✅ Successfully endorsed agent!

💰 **Endorsement Details:**
• Agent: ${targetAgentId}
• Reputation Points: ${amount}

🔗 **Transaction:**
• TX Hash: \`${result.transactionHash}\`
• View on BaseScan: https://sepolia.basescan.org/tx/${result.transactionHash}`;

                if (callback) {
                    await callback({
                        text: response,
                        actions: ['ENDORSE_AGENT_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: response,
                    success: true,
                    data: {
                        transactionHash: result.transactionHash,
                        targetAgentId,
                        amount: amount.toString(),
                    },
                };
            } else {
                const errorResponse = `❌ Failed to endorse agent ${targetAgentId}: ${result.error}`;

                if (callback) {
                    await callback({
                        text: errorResponse,
                        actions: ['ENDORSE_AGENT_ERC8004'],
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
            logger.error({ error }, 'Error in endorseAgent action:');
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
                    text: 'Endorse agent-123 with 10 points',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll endorse agent-123 for you",
                    actions: ['ENDORSE_AGENT_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'Vouch for alice with 50 reputation points',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll vouch for alice with 50 points",
                    actions: ['ENDORSE_AGENT_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'Increase reputation for bob by 25',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll increase bob's reputation by 25 points",
                    actions: ['ENDORSE_AGENT_ERC8004'],
                } as any,
            },
        ],
    ],
};

