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
import { ERC8004_SERVICE_NAME, getExplorerTxUrl, DEFAULT_CHAIN_ID } from '../constants';

/**
 * Interface representing the content of a penalization.
 */
interface PenalizeAgentContent extends Content {
    targetAgentId: string;
    amount: number | string;
    reason?: string;
}

/**
 * Checks if the given penalization content is valid.
 */
function isPenalizeAgentContent(content: PenalizeAgentContent): boolean {
    logger.log('Content for penalization', content as any);

    if (!content.targetAgentId || typeof content.targetAgentId !== 'string') {
        logger.warn('ERC8004 penalizeAgent: invalid targetAgentId');
        return false;
    }

    if (!content.amount || (typeof content.amount !== 'string' && typeof content.amount !== 'number')) {
        logger.warn({ type: typeof content.amount, value: content.amount }, 'ERC8004 penalizeAgent: invalid amount');
        return false;
    }

    logger.debug('ERC8004 penalizeAgent: content valid');
    return true;
}

/**
 * Template for determining the penalization details.
 */
const penalizationTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "targetAgentId": "agent-abc-123",
    "amount": 10,
    "reason": "Spam or malicious behavior"
}
\`\`\`

{{recentMessages}}

Extract the following information about the requested agent penalization:
- Target agent ID (the agent being penalized)
- Amount of reputation points to remove (default to 10 if not specified)
- Reason for penalization (optional)

Common patterns:
- "Penalize agent-123" → targetAgentId: "agent-123", amount: 10
- "Downvote alice by 50 points for spam" → targetAgentId: "alice", amount: 50, reason: "spam"
- "Remove 25 reputation from bob" → targetAgentId: "bob", amount: 25
- "Negative endorsement for charlie by 15" → targetAgentId: "charlie", amount: 15

Respond with a JSON markdown block containing only the extracted values. All fields except reason are required.

IMPORTANT: Your response must ONLY contain the json block above. Do not include any text, thinking, or reasoning before or after this JSON block. Start your response immediately with \`\`\`json and end with \`\`\`.`;

export const penalizeAgentAction: Action = {
    name: 'PENALIZE_AGENT_ERC8004',
    similes: ['PENALIZE_AGENT', 'DOWNVOTE_AGENT', 'NEGATIVE_ENDORSE', 'REMOVE_REPUTATION', 'DECREASE_REPUTATION'],
    description: 'Penalize an agent by reducing their reputation in the ERC-8004 system',

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

            // Compose prompt to extract penalization details from message
            logger.log('PENALIZE_AGENT_ERC8004 Starting handler...');

            const penalizationPrompt = composePromptFromState({
                state: state || {} as State,
                template: penalizationTemplate,
            });

            // Use LLM to extract penalization details
            const llmResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: penalizationPrompt,
            });

            const content = parseJSONObjectFromText(llmResponse) as PenalizeAgentContent;

            logger.log('PENALIZE_AGENT_ERC8004 extracted content:', content as any);

            // Validate extracted content
            if (!isPenalizeAgentContent(content)) {
                const errorMsg = 'Invalid penalization parameters provided. Please specify the agent ID and optionally the amount.';
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['PENALIZE_AGENT_ERC8004'],
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
            const reason = content.reason || 'Negative endorsement';

            logger.info(`Penalizing agent ${targetAgentId} by ${amount} points`);

            const result = await service.penalizeAgent({
                agentId: targetAgentId,
                amount,
            });

            if (result.success) {
                const response = `⚠️ Agent Penalized

🆔 **Agent:** ${targetAgentId}
⬇️ **Reputation Reduced:** ${amount} points
📝 **Reason:** ${reason}

🔗 **Transaction:**
• TX Hash: \`${result.transactionHash}\`
• View on Explorer: ${getExplorerTxUrl(DEFAULT_CHAIN_ID, result.transactionHash)}`;

                if (callback) {
                    await callback({
                        text: response,
                        actions: ['PENALIZE_AGENT_ERC8004'],
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
                        reason,
                    },
                };
            } else {
                const errorResponse = `❌ Failed to penalize agent ${targetAgentId}: ${result.error}`;

                if (callback) {
                    await callback({
                        text: errorResponse,
                        actions: ['PENALIZE_AGENT_ERC8004'],
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
            logger.error({ error }, 'Error in penalizeAgent action:');
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (callback) {
                await callback({
                    text: `❌ Failed to penalize agent: ${errorMsg}`,
                    actions: ['PENALIZE_AGENT_ERC8004'],
                    source: message.content.source,
                });
            }
            return {
                text: `Failed to penalize agent: ${errorMsg}`,
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
                    text: 'Penalize agent-123 by 50 points for spam',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll penalize agent-123 for spam behavior",
                    actions: ['PENALIZE_AGENT_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'Downvote alice by 25 points',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll reduce alice's reputation by 25 points",
                    actions: ['PENALIZE_AGENT_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'Remove 10 reputation from bob',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll remove 10 reputation points from bob",
                    actions: ['PENALIZE_AGENT_ERC8004'],
                } as any,
            },
        ],
    ],
};

