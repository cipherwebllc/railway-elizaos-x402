import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";

import { coinGeckoPlugin } from "./coingecko-plugin.ts";
import { newsPlugin } from "./news-plugin.ts";
import { gasMonitorPlugin } from "./gas-monitor-plugin.ts";
import { japanRegulationPlugin } from "./jp-regulation-plugin.ts";
import { deFiYieldPlugin } from "./defi-yield-plugin.ts";
import { exchangeMonitorPlugin } from "./exchange-monitor-plugin.ts";

// 1体目: Dliza - 規制・税制の専門家（x402課金）
import { character as baseCharacter } from "./character.ts";
// 2体目: Coo - Web3戦略家（x402課金）
import { twoCharacter } from "./two-character.ts";
// 3体目: Aliza - アフィリエイト誘導エージェント（x402課金なし）
import { alizaCharacter } from "./aliza-character.ts";

import plugin from "./plugin.ts"; // starter plugin
import { x402Plugin } from "./x402-plugin.ts";

// 1体目
const baseAgent: ProjectAgent = {
  character: baseCharacter,
  init: async (_runtime: IAgentRuntime) => {
    logger.info({ name: baseCharacter.name }, "Base agent initialized");
  },
  plugins: [
    coinGeckoPlugin,
    newsPlugin,
    gasMonitorPlugin,
    japanRegulationPlugin,
    deFiYieldPlugin,
    exchangeMonitorPlugin,
    x402Plugin,
    plugin,
  ],
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
  plugins: [
    coinGeckoPlugin,
    newsPlugin,
    gasMonitorPlugin,
    japanRegulationPlugin,
    deFiYieldPlugin,
    exchangeMonitorPlugin,
    x402Plugin,
    plugin,
  ],
};

// 3体目: Aliza - x402課金なしでアフィリエイト誘導
const alizaAgent: ProjectAgent = {
  character: alizaCharacter,
  init: async (_runtime: IAgentRuntime) => {
    logger.info(
      { name: alizaCharacter.name },
      "Aliza agent initialized (no x402 payment required)",
    );
  },
  plugins: [
    // x402Pluginは含めない（課金なし）
    newsPlugin,
    plugin,
  ],
};

export const project: Project = {
  agents: [baseAgent, twoAgent, alizaAgent],
};

export { baseCharacter as character };

export default project;