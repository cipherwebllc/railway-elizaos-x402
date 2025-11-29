import {
    Action,
    composeContext,
    Content,
    generateObject,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State
} from "@elizaos/core";
import { z, type ZodType } from "zod";

export interface RetrieveNewsContent extends Content {
    limit: number;
}

export const RetrieveNewsSchema: ZodType = z.object({
    limit: z.number().max(100).default(10),
});

const retrieveNewTemplate = `Respond with a JSON markdown block containing only the extracted values.

Example responses:
\`\`\`json
{
    "limit": 10
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values.`;

export const newsAction: Action = {
    name: "CRYPTO_NEWS",
    description: "Get the latest crypto news from RSS3 network",
    similes: [
        "CRYPTO_INTELLIGENCES",
        "CRYPTO_FEEDS",
    ],
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "What are the latest news about crypto?",
                }
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll retrieve the recent crypto news for you.",
                    action: "CRYPTO_NEWS",
                    limit: 10,
                }
            },
            {
                user: "{{agent}}",
                content: {
                    text:
                        "Here's a summary of recent crypto news:\n\n" +
                        "- French Blockchain Group's Bitcoin Holdings Rise to $54 Million\n" +
                        "- BlackRock’s IBIT dominates Bitcoin ETFs with $107.9 million in inflows\n" +
                        "- Polymarket, UMA Communities Lock Horns After $7M Ukraine Bet Resolves\n" +
                        "- Bitcoin Whales Bought $11B of BTC in Two Weeks as Confidence Grew, Glassnode Says\n" +
                        "- South Korean exchange UPbit saw massive earnings growth in 2024 amid regulatory hiccups\n" +
                        "- Trump SEC Pick Paul Atkins’ Crypto Ties Draw Sen. Warren’s Ire Ahead of Confirmation Hearing\n" +
                        "- Crypto Daybook Americas: Trump's New Tariff Threat Fails to Budge Bitcoin\n" +
                        "- Public trust in Argentine president Javier Milei craters after LIBRA memecoin scandal\n" +
                        "- Like DOGE, XRP Going Vertical Is a Good Indicator of Market Froth, Bitcoin Peaks\n" +
                        "- Hyperliquid whale still holds 10% of JELLY memecoin after $6.2M exploit",
                    action: "CRYPTO_NEWS",
                }
            }
        ]
    ],
    validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
        return true;
    },
    handler: async (runtime: IAgentRuntime, message: Memory, state?: State, _options?: {
        [key: string]: unknown;
    }, callback?: HandlerCallback): Promise<boolean> => {
        let currentState = state;

        if (!currentState) {
            currentState = (await runtime.composeState(message)) as State;
        } else {
            currentState = await runtime.updateRecentMessageState(currentState);
        }

        const retrieveNewsContext = composeContext({
            state: currentState,
            template: retrieveNewTemplate,
        });

        const { object } = await generateObject({
            runtime,
            context: retrieveNewsContext,
            modelClass: ModelClass.SMALL,
            schema: RetrieveNewsSchema as any,
        });

        const retrieveNewsContent = object as RetrieveNewsContent;

        const news: any[] = await fetch(`https://ai.rss3.io/api/v1/ai_intel?limit=${retrieveNewsContent.limit}`).then((response) => response.json());

        if (callback) {
            await callback({
                text: "Here's a summary of recent crypto news:\n\n" + news.map(value => `- ${value["agent_insight"]}`).join("\n"),
                content: news,
            });
        }

        return true;
    },
}
