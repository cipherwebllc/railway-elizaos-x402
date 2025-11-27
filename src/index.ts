import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";

import { coinGeckoPlugin } from "./coingecko-plugin.ts";
import { newsPlugin } from "./news-plugin.ts";

// 1体目: もともとの相談エージェント
import { character as baseCharacter } from "./character.ts";
// 2体目: さっき作った Hyperliza用キャラ
import { twoCharacter } from "./two-character.ts";

import plugin from "./plugin.ts"; // starter plugin
import { x402Plugin } from "./x402-plugin.ts";

// 1体目
const baseAgent: ProjectAgent = {
  character: baseCharacter,
  init: async (_runtime: IAgentRuntime) => {
    logger.info({ name: baseCharacter.name }, "Base agent initialized");
  },
  plugins: [coinGeckoPlugin, newsPlugin, x402Plugin, plugin],
};

// 2体目
const twoAgent: ProjectAgent = {
  character: twoCharacter,
  init: async (_runtime: IAgentRuntime) => {
    logger.info(
      { name: twoCharacter.name },
      "Two agent initialized",
    );
  },
  plugins: [coinGeckoPlugin, newsPlugin, x402Plugin, plugin],
};

export const project: Project = {
  agents: [baseAgent, twoAgent], // ← ここが一番重要
};

export { baseCharacter as character };

export default project;