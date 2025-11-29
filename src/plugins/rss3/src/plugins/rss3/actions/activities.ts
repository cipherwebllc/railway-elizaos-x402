import {
    Action,
    composeContext,
    Content,
    generateObject,
    generateText,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State
} from "@elizaos/core";
import { z, type ZodType } from "zod";
import { getActivities, Network, Platform, Tag, Type } from "@rss3/sdk";

export interface RetrieveActivitiesContent extends Content {
    account: string;
    tag: string | undefined;
    type: string | undefined;
    network: string | undefined;
    platform: string | undefined;
    limit: number;
}

export const RetrieveActivitiesSchema: ZodType = z.object({
    account: z.string(),
    tag: z.enum(["collectible", "exchange", "governance", "metaverse", "rss", "social", "transaction", "unknown"]).optional(),
    type: z.enum(["post", "delete", "unknown", "approval", "auction", "bridge", "burn", "comment", "feed", "liquidity", "loan", "mint", "profile", "proposal", "proxy", "revise", "reward", "share", "staking", "swap", "trade", "transfer", "vote"]).optional(),
    network: z.enum(["arbitrum", "arweave", "avax", "base", "binance-smart-chain", "crossbell", "ethereum", "farcaster", "gnosis", "linea", "mastodon", "near", "optimism", "polygon", "vsl", "x-layer"]).optional(),
    platform: z.enum(["1inch", "AAVE", "Aavegotchi", "Arbitrum", "Base", "BendDAO", "Cow", "Crossbell", "Curve", "ENS", "Farcaster", "Highlight", "IQWiki", "KiwiStand", "Lens", "LiNEAR", "Lido", "Linea", "LooksRare", "Matters", "Mirror", "NearSocial", "Nouns", "OpenSea", "Optimism", "Paragraph", "Paraswap", "Polymarket", "RSS3", "Rainbow", "SAVM", "Stargate", "Uniswap", "Unknown", "VSL", "Zerion"]).optional(),
    limit: z.number().max(100).default(10),
});

const retrieveActivitiesTemplate = `Respond with a JSON markdown block containing only the extracted values.

Example responses:
\`\`\`json
{
    "account": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "platform": "uniswap",
    "network": "ethereum",
}
\`\`\`

\`\`\`json
{
    "account": "vitalik.eth",
    "network": "base",
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values.`;

export const activitiesAction: Action = {
    name: "ACTIVITIES",
    description: "Get activities of the account from RSS3 network",
    similes: [
        "ACCOUNT_ACTIVITIES",
        "ADDRESS_ACTIVITIES",
    ],
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "What are the recent activities of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?",
                }
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll retrieve the recent activities of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 for you.",
                    action: "ACTIVITIES",
                    account: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
                    network: "ethereum",
                    platform: "uniswap",
                }
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Here's a summary of recent activities of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045:",
                }
            },
        ]
    ],
    validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
        return true;
    },
    handler: async (runtime: IAgentRuntime, message: Memory, state?: State, _options?: {
        [key: string]: unknown;
    }, callback?: HandlerCallback): Promise<boolean> => {
        let currentState: State;

        if (!state) {
            currentState = (await runtime.composeState(message)) as State;
        } else {
            currentState = await runtime.updateRecentMessageState(state);
        }

        const retrieveActivitiesContext = composeContext({
            state: currentState,
            template: retrieveActivitiesTemplate,
        });

        const { object } = await generateObject({
            runtime,
            context: retrieveActivitiesContext,
            modelClass: ModelClass.SMALL,
            schema: RetrieveActivitiesSchema as any,
        });

        const retrieveActivitiesContent = object as RetrieveActivitiesContent;

        const response = await getActivities({
            account: retrieveActivitiesContent.account,
            tag: !retrieveActivitiesContent.tag ? undefined : [retrieveActivitiesContent.tag as Tag],
            type: !retrieveActivitiesContent.type ? undefined : [retrieveActivitiesContent.type as Type],
            network: retrieveActivitiesContent.network ? [retrieveActivitiesContent.network as Network] : undefined,
            platform: retrieveActivitiesContent.platform ? [retrieveActivitiesContent.platform as Platform] : undefined,
            limit: retrieveActivitiesContent.limit,
        });

        if (callback) {
            const summary = await generateText({
                runtime,
                context: `These are structured data about ${retrieveActivitiesContent.account}'s activities, lease summarize them in a human-readable format.

                Human-readable formats such as:
                    - On Feb 1, 2025 14:00:00 UTC, this account post a technical content on Lens about how the new EIP works.
                    - On January 1, 2025 at 13:00:00 UTC, this account swap 1000 USDC to 1000 USDT in Uniswap on the Base network.

                ${JSON.stringify(response.data)}`,
                modelClass: ModelClass.LARGE,
            });

            await callback({ text: summary });
        }

        return true;
    },
}
