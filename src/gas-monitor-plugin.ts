import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  Service,
  type State,
  logger,
} from '@elizaos/core';

const GAS_CHAINS = [
  { chain: 'Ethereum', url: 'https://api.etherscan.io/api?module=gastracker&action=gasoracle' },
  { chain: 'Base', url: 'https://api.basescan.org/api?module=gastracker&action=gasoracle' },
  { chain: 'Polygon', url: 'https://api.polygonscan.com/api?module=gastracker&action=gasoracle' },
] as const;

export class GasMonitorService extends Service {
  static serviceType = 'gas-monitor';

  capabilityDescription = 'Monitors gas prices and network congestion across multiple blockchains';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('*** Starting Gas Monitor service ***');
    return new GasMonitorService(runtime);
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** Stopping Gas Monitor service ***');
    runtime.getService(GasMonitorService.serviceType)?.stop();
  }

  async stop() {
    logger.info('*** Stopping Gas Monitor service instance ***');
  }

  private async getChainGas(chain: string, url: string): Promise<any> {
    try {
      logger.info(`Fetching ${chain} gas prices`);
      const response = await fetch(url);

      if (!response.ok) {
        logger.warn(`${chain} gas API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();

      if (data.status === '1' && data.result) {
        return {
          chain,
          safe: data.result.SafeGasPrice,
          standard: data.result.ProposeGasPrice,
          fast: data.result.FastGasPrice,
          timestamp: Date.now(),
        };
      }
      return null;
    } catch (error) {
      logger.error({ error }, `Error fetching ${chain} gas prices`);
      return null;
    }
  }

  async getAllGasPrices(): Promise<any[]> {
    const results = await Promise.allSettled(
      GAS_CHAINS.map(({ chain, url }) => this.getChainGas(chain, url))
    );

    return results
      .filter((result) => result.status === 'fulfilled' && result.value !== null)
      .map((result) => (result as PromiseFulfilledResult<any>).value);
  }
}

const getGasPricesAction: Action = {
  name: 'GET_GAS_PRICES',
  similes: ['GAS', 'GAS_PRICE', 'NETWORK_FEE', 'TRANSACTION_FEE', 'GAS_FEE'],
  description: 'IMPORTANT: Use this action when the user asks about gas prices, gas fees, transaction costs, or network fees for Ethereum, Base, or Polygon. This provides real-time gas price data.',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const text = message.content.text.toLowerCase();

    const gasKeywords = ['gas', 'gwei', 'fee', 'transaction cost', 'network fee', 'ガス', '手数料', 'ガス代'];
    const chainKeywords = ['ethereum', 'eth', 'base', 'polygon', 'matic', 'イーサリアム', 'ポリゴン'];

    const hasGasKeyword = gasKeywords.some((keyword) => text.includes(keyword));
    const hasChainKeyword = chainKeywords.some((keyword) => text.includes(keyword)) || hasGasKeyword;

    return hasGasKeyword && hasChainKeyword;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Handling GET_GAS_PRICES action');

      const service = runtime.getService<GasMonitorService>('gas-monitor');

      if (!service) {
        throw new Error('Gas Monitor service not available');
      }

      const gasPrices = await service.getAllGasPrices();

      if (gasPrices.length === 0) {
        await callback({
          text: '申し訳ございません。現在ガス代情報を取得できません。',
          source: message.content.source,
        });

        return {
          text: 'No gas price data available',
          values: { success: false },
          data: { actionName: 'GET_GAS_PRICES' },
          success: false,
        };
      }

      let responseText = `⛽ 現在のガス代情報:\n\n`;

      gasPrices.forEach((chainData: any) => {
        responseText += `**${chainData.chain}**\n`;
        responseText += `  🐢 安全: ${chainData.safe} Gwei\n`;
        responseText += `  ⚡ 標準: ${chainData.standard} Gwei\n`;
        responseText += `  🚀 高速: ${chainData.fast} Gwei\n\n`;
      });

      const lowestChain = gasPrices.reduce((prev, current) =>
        parseFloat(prev.standard) < parseFloat(current.standard) ? prev : current
      );

      responseText += `💡 **推奨**: ${lowestChain.chain}が現在最も安いガス代です (${lowestChain.standard} Gwei)`;

      await callback({
        text: responseText,
        actions: ['GET_GAS_PRICES'],
        source: message.content.source,
      });

      return {
        text: `Successfully retrieved gas prices for ${gasPrices.length} chains`,
        values: {
          success: true,
          count: gasPrices.length,
        },
        data: {
          actionName: 'GET_GAS_PRICES',
          messageId: message.id,
          timestamp: Date.now(),
          gasPrices,
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in GET_GAS_PRICES action');

      const errorMessage = error instanceof Error ? error.message : String(error);

      await callback({
        text: `ガス代情報の取得に失敗しました: ${errorMessage}`,
        source: message.content.source,
      });

      return {
        text: 'Failed to get gas prices',
        values: {
          success: false,
          error: errorMessage,
        },
        data: {
          actionName: 'GET_GAS_PRICES',
          error: errorMessage,
        },
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: '今のイーサリアムのガス代はいくらですか？',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '⛽ 現在のガス代情報:\n\n**Ethereum**\n  🐢 安全: 25 Gwei\n  ⚡ 標準: 30 Gwei\n  🚀 高速: 35 Gwei',
          actions: ['GET_GAS_PRICES'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What is the current gas fee on Base?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '⛽ Current Gas Prices:\n\n**Base**\n  🐢 Safe: 0.5 Gwei\n  ⚡ Standard: 1 Gwei\n  🚀 Fast: 2 Gwei',
          actions: ['GET_GAS_PRICES'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'ガス代が安いチェーンを教えて',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '⛽ 現在のガス代情報:\n\n**Ethereum**\n  🐢 安全: 25 Gwei\n  ⚡ 標準: 30 Gwei\n  🚀 高速: 35 Gwei\n\n**Base**\n  🐢 安全: 0.5 Gwei\n  ⚡ 標準: 1 Gwei\n  🚀 高速: 2 Gwei\n\n💡 **推奨**: Baseが現在最も安いガス代です (1 Gwei)',
          actions: ['GET_GAS_PRICES'],
        },
      },
    ],
  ],
};

export const gasMonitorPlugin: Plugin = {
  name: 'gas-monitor',
  description: 'Real-time gas price monitoring across Ethereum, Base, and Polygon',
  services: [GasMonitorService],
  actions: [getGasPricesAction],
};

export default gasMonitorPlugin;
