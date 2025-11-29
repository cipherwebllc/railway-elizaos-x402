import { Plugin } from "@elizaos/core";
import { activitiesAction } from "./actions/activities";
import { newsAction } from "./actions/news.ts";

export const rss3Plugin: Plugin = {
    name: "rss3",
    description: "A RSS3 plugin for ElizaOS",
    actions: [
        activitiesAction,
        newsAction,
    ]
}

export default rss3Plugin;
