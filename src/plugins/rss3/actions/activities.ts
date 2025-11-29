import {
    Action,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State
} from "@elizaos/core";
import { getActivities } from "@rss3/sdk";

export const activitiesAction: Action = {
    name: "ACTIVITIES",
    description: "Get activities of the account from RSS3 network",
    similes: [
        "ACCOUNT_ACTIVITIES",
        "ADDRESS_ACTIVITIES",
        "WALLET_ACTIVITIES",
    ],
    examples: [],
    validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
        return true;
    },
    handler: async (_runtime: IAgentRuntime, message: Memory, _state?: State, _options?: {
        [key: string]: unknown;
    }, callback?: HandlerCallback): Promise<void> => {
        try {
            // Extract Ethereum address from message
            const text = message.content.text || '';
            const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);

            if (!addressMatch) {
                if (callback) {
                    await callback({
                        text: "Please provide a valid Ethereum address (0x...).",
                    });
                }
                return;
            }

            const account = addressMatch[0];
            const response = await getActivities({
                account,
                limit: 10,
            });

            if (callback) {
                const activities = response.data || [];
                if (activities.length === 0) {
                    await callback({
                        text: `No recent activities found for ${account}.`,
                    });
                } else {
                    const summary = activities.slice(0, 5).map((activity: any) => {
                        const timestamp = new Date(activity.timestamp * 1000).toLocaleString();
                        const type = activity.type || 'unknown';
                        const platform = activity.platform || 'unknown';
                        return `- ${timestamp}: ${type} on ${platform}`;
                    }).join('\n');

                    await callback({
                        text: `Recent activities for ${account}:\n\n${summary}`,
                        content: activities,
                    });
                }
            }
        } catch (error) {
            if (callback) {
                await callback({
                    text: "Failed to retrieve activities. Please try again later.",
                    content: { error: String(error) },
                });
            }
        }
    },
}
