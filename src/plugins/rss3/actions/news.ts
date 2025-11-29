import {
    Action,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State
} from "@elizaos/core";

export const newsAction: Action = {
    name: "CRYPTO_NEWS",
    description: "Get the latest crypto news from RSS3 network",
    similes: [
        "CRYPTO_INTELLIGENCES",
        "CRYPTO_FEEDS",
        "NEWS",
        "LATEST_NEWS"
    ],
    examples: [],
    validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
        return true;
    },
    handler: async (_runtime: IAgentRuntime, _message: Memory, _state?: State, _options?: {
        [key: string]: unknown;
    }, callback?: HandlerCallback): Promise<void> => {
        try {
            const limit = 10;
            const news: any[] = await fetch(`https://ai.rss3.io/api/v1/ai_intel?limit=${limit}`)
                .then((response) => response.json());

            if (callback) {
                await callback({
                    text: "Here's a summary of recent crypto news:\n\n" + news.map(value => `- ${value["agent_insight"]}`).join("\n"),
                    content: news,
                });
            }
        } catch (error) {
            if (callback) {
                await callback({
                    text: "Failed to retrieve crypto news. Please try again later.",
                    content: { error: String(error) },
                });
            }
        }
    },
}
