import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";

// OpenRouter plugin for LLM
import openrouterPlugin from "@elizaos/plugin-openrouter";
import mcpPlugin from "@elizaos/plugin-mcp";
import twitterPlugin from "@elizaos/plugin-twitter";

// Wrap Twitter plugin to catch and explicitly log initialization errors
// (Railway drops 5000+ logs during startup, hiding the real error)
const wrappedTwitterServices = (twitterPlugin.services || []).map((ServiceClass: any) => {
  const originalStart = ServiceClass.start;
  const wrappedClass = class extends ServiceClass {
    static serviceType = ServiceClass.serviceType;
    static async start(runtime: IAgentRuntime) {
      try {
        logger.info(`[TwitterInit] Starting Twitter service (serviceType=${ServiceClass.serviceType})...`);
        const instance = await originalStart.call(ServiceClass, runtime);
        logger.info('[TwitterInit] Twitter service started successfully!');
        return instance;
      } catch (error: any) {
        logger.error(`[TwitterInit] FAILED TO START: ${error.message}`);
        logger.error(`[TwitterInit] Stack: ${error.stack?.split('\n').slice(0, 3).join(' | ')}`);
        throw error;
      }
    }
  };
  return wrappedClass;
});

const wrappedTwitterPlugin = {
  ...twitterPlugin,
  services: wrappedTwitterServices,
};

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
import { erc8004Plugin } from "./plugins/erc8004/index.ts";
import { agentCommPlugin } from "./agent-comm-plugin.ts";
import { aegisBriefingPlugin } from "./aegis-briefing-plugin.ts";
import { aegisTwitterPlugin } from "./aegis-twitter-plugin.ts";

// 1体目
const baseAgent: ProjectAgent = {
  character: baseCharacter,
  init: async (_runtime: IAgentRuntime) => {
    logger.info({ name: baseCharacter.name }, "Base agent initialized");
  },
  plugins: [
    openrouterPlugin,
    coinGeckoPlugin,
    newsPlugin,
    gasMonitorPlugin,
    japanRegulationPlugin,
    deFiYieldPlugin,
    exchangeMonitorPlugin,
    x402Plugin,
    agentCommPlugin,  // Agent-to-agent communication with Eliza Cloud
    // erc8004Plugin,  // 一時的に無効化 - 複数応答問題のデバッグ
    plugin,
  ],
};

// 2体目
const twoAgent: ProjectAgent = {
  character: twoCharacter,
  init: async (runtime: IAgentRuntime) => {
    logger.info(
      { name: twoCharacter.name },
      "Two agent initialized",
    );
    // Diagnostic: check Twitter service registration after 10s
    setTimeout(() => {
      const twSvc = runtime.getService('twitter');
      if (twSvc) {
        logger.info('[Coo:init] Twitter service is registered');
      } else {
        // List all registered services for debugging
        logger.warn('[Coo:init] Twitter service NOT found after 10s');
        try {
          // Try to see what services are available
          const allServices = (runtime as any).services || (runtime as any)._services;
          if (allServices) {
            const serviceNames = allServices instanceof Map
              ? Array.from(allServices.keys())
              : Object.keys(allServices);
            logger.warn(`[Coo:init] Available services: ${JSON.stringify(serviceNames)}`);
          }
        } catch (e) {
          logger.warn(`[Coo:init] Could not enumerate services: ${e}`);
        }
      }
    }, 10_000);
  },
  plugins: [
    openrouterPlugin,
    mcpPlugin,  // MCP (appfav-gateway) を使用
    // coinGeckoPlugin を削除 - MCPを使用
    newsPlugin,
    gasMonitorPlugin,
    japanRegulationPlugin,
    deFiYieldPlugin,
    exchangeMonitorPlugin,
    x402Plugin,
    agentCommPlugin,  // Agent-to-agent communication with Eliza Cloud
    wrappedTwitterPlugin,  // @elizaos/plugin-twitter — Twitter サービス本体 (with error logging)
    aegisBriefingPlugin,  // Aegis D2A Briefing API (x402対応)
    aegisTwitterPlugin,   // Aegis → Twitter 定期ポスト
    // erc8004Plugin,  // 一時的に無効化 - 複数応答問題のデバッグ
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
    openrouterPlugin,
    mcpPlugin,  // MCP (appfav-gateway) を使用
    // x402Pluginは含めない（課金なし）
    newsPlugin,
    agentCommPlugin,  // Agent-to-agent communication with Eliza Cloud
    // erc8004Plugin,  // 一時的に無効化 - 複数応答問題のデバッグ
    plugin,
  ],
};

export const project: Project = {
  agents: [baseAgent, twoAgent, alizaAgent],
};

export { baseCharacter as character };

export default project;