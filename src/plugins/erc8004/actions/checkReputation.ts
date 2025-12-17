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
 * Interface representing the content of a reputation check.
 */
interface CheckReputationContent extends Content {
    agentId: string;
}

/**
 * Checks if the given reputation check content is valid.
 */
function isCheckReputationContent(content: CheckReputationContent): boolean {
    logger.log('Content for reputation check', JSON.stringify(content) as any);

    if (!content.agentId || typeof content.agentId !== 'string') {
        console.warn('bad agentId');
        return false;
    }

    console.log('reputation check content valid');
    return true;
}

/**
 * Template for determining the reputation check details.
 */
const reputationCheckTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "agentId": "agent-123"
}
\`\`\`

{{recentMessages}}

Extract the following information about the requested reputation check:
- Agent ID (the agent whose reputation to check)

Common patterns:
- "Check reputation of agent-123" → agentId: "agent-123"
- "What is alice's reputation?" → agentId: "alice"
- "Show me bob's reputation score" → agentId: "bob"
- "Check my reputation" → agentId: "self" (will use current agent's ID)

If the user asks about "my" or "self" reputation, use "self" as the agentId.

Respond with a JSON markdown block containing only the extracted values. The agentId field is required.

IMPORTANT: Your response must ONLY contain the json block above. Do not include any text, thinking, or reasoning before or after this JSON block. Start your response immediately with \`\`\`json and end with \`\`\`.`;

export const checkReputationAction: Action = {
    name: 'CHECK_REPUTATION_ERC8004',
    similes: ['CHECK_REPUTATION', 'GET_REPUTATION_SCORE', 'VIEW_REPUTATION'],
    description: 'Check the reputation score of an agent in the ERC-8004 system',

    validate: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined): Promise<boolean> => {
        // Only validate if message mentions reputation-related keywords
        const text = (message.content?.text || '').toLowerCase();
        const hasReputationKeyword =
            text.includes('reputation') ||
            text.includes('評判') ||
            text.includes('score') ||
            text.includes('8004') ||
            text.includes('on-chain') ||
            text.includes('onchain');

        if (!hasReputationKeyword) {
            return false;
        }

        const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
        return service !== null;
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

            // Compose prompt to extract reputation check details from message
            logger.log('CHECK_REPUTATION_ERC8004 Starting handler...');

            const reputationCheckPrompt = composePromptFromState({
                state: state || {} as State,
                template: reputationCheckTemplate,
            });

            // Use LLM to extract reputation check details
            const llmResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: reputationCheckPrompt,
            });

            const content = parseJSONObjectFromText(llmResponse) as CheckReputationContent;

            logger.log('CHECK_REPUTATION_ERC8004 extracted content:', content as any);

            // Handle "self" or use default to current agent
            let agentId = content.agentId;
            if (!agentId || agentId === 'self' || agentId === 'me') {
                agentId = runtime.agentId;
            }

            // Validate extracted content
            if (!isCheckReputationContent({ ...content, agentId })) {
                const errorMsg = 'Invalid reputation check parameters provided. Please specify the agent ID.';
                if (callback) {
                    await callback({
                        text: errorMsg,
                        actions: ['CHECK_REPUTATION_ERC8004'],
                        source: message.content.source,
                    });
                }
                return {
                    text: errorMsg,
                    success: false,
                    error: new Error(errorMsg),
                };
            }

            logger.info(`Checking reputation for agent ${agentId}`);

            const reputationScore = await service.getAgentReputation(agentId);

            if (reputationScore) {
                const formattedScore = service.formatReputation(reputationScore.score);
                const response = `✅ Reputation Score Retrieved

🆔 **Agent:** ${agentId}
⭐ **Reputation Score:** ${formattedScore}
🕐 **Last Updated:** ${new Date(Number(reputationScore.timestamp) * 1000).toLocaleString()}`;

                if (callback) {
                    await callback({
                        text: response,
                        actions: ['CHECK_REPUTATION_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: response,
                    success: true,
                    data: {
                        agentId,
                        score: formattedScore,
                        timestamp: reputationScore.timestamp,
                    },
                };
            } else {
                const response = `❌ Could not retrieve reputation for agent **${agentId}**

The agent may not be registered yet. To register, use the REGISTER_AGENT action.`;

                if (callback) {
                    await callback({
                        text: response,
                        actions: ['CHECK_REPUTATION_ERC8004'],
                        source: message.content.source,
                    });
                }

                return {
                    text: response,
                    success: false,
                };
            }
        } catch (error) {
            logger.error({ error }, 'Error in checkReputation action:');
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
                    text: 'What is my reputation?',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll check your reputation for you",
                    actions: ['CHECK_REPUTATION_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: 'Check reputation of agent-123',
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll look up agent-123's reputation",
                    actions: ['CHECK_REPUTATION_ERC8004'],
                } as any,
            },
        ],
        [
            {
                name: '{{userName}}',
                content: {
                    text: "What is alice's reputation score?",
                } as any,
            },
            {
                name: '{{agentName}}',
                content: {
                    text: "I'll check alice's reputation on-chain",
                    actions: ['CHECK_REPUTATION_ERC8004'],
                } as any,
            },
        ],
    ],
};

