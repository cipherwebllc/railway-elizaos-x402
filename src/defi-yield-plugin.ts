import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  Service,
  type State,
  logger,
} from '@elizaos/core';

/**
 * DeFi Yield Service
 * Provides DeFi yield farming and staking opportunities
 */
export class DeFiYieldService extends Service {
  static serviceType = 'defi-yield';

  capabilityDescription = 'Provides DeFi yield farming and staking opportunity information';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('*** Starting DeFi Yield service ***');
    const service = new DeFiYieldService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** Stopping DeFi Yield service ***');
    const service = runtime.getService(DeFiYieldService.serviceType);
    if (service) {
      service.stop();
    }
  }

  async stop() {
    logger.info('*** Stopping DeFi Yield service instance ***');
  }

  /**
   * Get top yield farming opportunities from DeFiLlama
   */
  async getTopYields(minTVL: number = 1000000): Promise<any[]> {
    try {
      const url = 'https://yields.llama.fi/pools';
      logger.info('Fetching DeFi yield opportunities from DeFiLlama');

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'success' && data.data) {
        // Filter and sort pools
        const pools = data.data
          .filter((pool: any) => {
            return (
              pool.tvlUsd >= minTVL &&
              pool.apy > 0 &&
              pool.apyBase !== null &&
              !pool.project.toLowerCase().includes('scam') &&
              pool.exposure !== 'multi' // Avoid complex multi-asset pools for safety
            );
          })
          .sort((a: any, b: any) => {
            // Sort by APY, but prioritize stable pools
            const aScore = a.apy * (a.stablecoin ? 1.5 : 1);
            const bScore = b.apy * (b.stablecoin ? 1.5 : 1);
            return bScore - aScore;
          })
          .slice(0, 10);

        logger.info(`Retrieved ${pools.length} yield opportunities`);
        return pools;
      }
      return [];
    } catch (error) {
      logger.error({ error }, 'Error fetching DeFi yields');
      return [];
    }
  }

  /**
   * Get stablecoin yield opportunities
   */
  async getStablecoinYields(): Promise<any[]> {
    try {
      const url = 'https://yields.llama.fi/pools';
      logger.info('Fetching stablecoin yield opportunities');

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'success' && data.data) {
        const stablecoins = data.data
          .filter((pool: any) => {
            return (
              pool.stablecoin === true &&
              pool.tvlUsd >= 500000 &&
              pool.apy > 0 &&
              pool.apyBase !== null &&
              !pool.project.toLowerCase().includes('scam')
            );
          })
          .sort((a: any, b: any) => b.apy - a.apy)
          .slice(0, 10);

        logger.info(`Retrieved ${stablecoins.length} stablecoin yield opportunities`);
        return stablecoins;
      }
      return [];
    } catch (error) {
      logger.error({ error }, 'Error fetching stablecoin yields');
      return [];
    }
  }

  /**
   * Get chain-specific yield opportunities
   */
  async getChainYields(chain: string): Promise<any[]> {
    try {
      const url = 'https://yields.llama.fi/pools';
      logger.info(`Fetching yield opportunities for ${chain}`);

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'success' && data.data) {
        const chainNormalized = chain.toLowerCase();
        const pools = data.data
          .filter((pool: any) => {
            return (
              pool.chain.toLowerCase() === chainNormalized &&
              pool.tvlUsd >= 100000 &&
              pool.apy > 0 &&
              pool.apyBase !== null &&
              !pool.project.toLowerCase().includes('scam')
            );
          })
          .sort((a: any, b: any) => b.apy - a.apy)
          .slice(0, 10);

        logger.info(`Retrieved ${pools.length} yield opportunities for ${chain}`);
        return pools;
      }
      return [];
    } catch (error) {
      logger.error({ error }, `Error fetching yields for ${chain}`);
      return [];
    }
  }
}

/**
 * Get DeFi Yield Action
 * Fetches DeFi yield farming and staking opportunities
 */
const getDeFiYieldAction: Action = {
  name: 'GET_DEFI_YIELD',
  similes: ['YIELD', 'APY', 'STAKING', 'FARMING', 'LIQUIDITY'],
  description:
    'IMPORTANT: Use this action when the user asks about DeFi yields, APY, staking opportunities, yield farming, liquidity mining, or passive income from crypto. This provides real yield data.',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const text = message.content.text.toLowerCase();

    const yieldKeywords = [
      'yield',
      'apy',
      'apr',
      'staking',
      'farming',
      'liquidity',
      'passive income',
      'earn',
      '利回り',
      'ステーキング',
      'イールド',
      '運用',
      '金利',
    ];
    const defiKeywords = ['defi', 'protocol', 'pool', 'lp', 'liquidity provider', 'プロトコル', 'プール'];

    const hasYieldKeyword = yieldKeywords.some((keyword) => text.includes(keyword));
    const hasDeFiContext = defiKeywords.some((keyword) => text.includes(keyword)) || hasYieldKeyword;

    const isYieldQuery = hasYieldKeyword && hasDeFiContext;

    if (isYieldQuery) {
      logger.info(`[GET_DEFI_YIELD] Validate returned TRUE for: "${message.content.text}"`);
    }

    return isYieldQuery;
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
      logger.info('Handling GET_DEFI_YIELD action');

      const service = runtime.getService<DeFiYieldService>('defi-yield');

      if (!service) {
        throw new Error('DeFi Yield service not available');
      }

      const text = message.content.text.toLowerCase();
      let yields: any[] = [];
      let title = '';

      // Determine which yields to fetch based on query
      if (text.includes('stablecoin') || text.includes('stable') || text.includes('ステーブル')) {
        yields = await service.getStablecoinYields();
        title = 'ステーブルコインの利回り機会';
      } else if (
        text.includes('ethereum') ||
        text.includes('eth') ||
        text.includes('base') ||
        text.includes('polygon') ||
        text.includes('arbitrum')
      ) {
        // Extract chain name
        let chain = 'Ethereum';
        if (text.includes('base')) chain = 'Base';
        else if (text.includes('polygon')) chain = 'Polygon';
        else if (text.includes('arbitrum')) chain = 'Arbitrum';

        yields = await service.getChainYields(chain);
        title = `${chain}の利回り機会`;
      } else {
        yields = await service.getTopYields();
        title = 'トップDeFi利回り機会';
      }

      if (yields.length === 0) {
        await callback({
          text: '申し訳ございません。現在利回り情報を取得できません。',
          source: message.content.source,
        });

        return {
          text: 'No yield data available',
          values: { success: false },
          data: { actionName: 'GET_DEFI_YIELD' },
          success: false,
        };
      }

      // Format response
      let responseText = `💰 **${title}** (上位${yields.length}件)\n\n`;

      yields.slice(0, 5).forEach((pool: any, index: number) => {
        const apy = pool.apy.toFixed(2);
        const tvl = (pool.tvlUsd / 1000000).toFixed(2);
        const chain = pool.chain;
        const project = pool.project;
        const symbol = pool.symbol;
        const stableTag = pool.stablecoin ? ' 🟢 Stable' : '';

        responseText += `${index + 1}. **${symbol}** on ${project} (${chain})${stableTag}\n`;
        responseText += `   📊 APY: ${apy}%\n`;
        responseText += `   💎 TVL: $${tvl}M\n`;

        if (pool.apyBase && pool.apyReward) {
          responseText += `   ├─ Base APY: ${pool.apyBase.toFixed(2)}%\n`;
          responseText += `   └─ Reward APY: ${pool.apyReward.toFixed(2)}%\n`;
        }

        responseText += `\n`;
      });

      responseText += `\n⚠️ **注意事項**:\n`;
      responseText += `- 高いAPYには高いリスクが伴います\n`;
      responseText += `- スマートコントラクトリスクを理解してください\n`;
      responseText += `- インパーマネントロスに注意してください\n`;
      responseText += `- 必ず自己調査（DYOR）を行ってください\n\n`;
      responseText += `_データはDeFiLlamaより取得（リアルタイム）_`;

      const responseContent: Content = {
        text: responseText,
        actions: ['GET_DEFI_YIELD'],
        source: message.content.source,
      };

      await callback(responseContent);

      return {
        text: `Successfully retrieved ${yields.length} yield opportunities`,
        values: {
          success: true,
          count: yields.length,
        },
        data: {
          actionName: 'GET_DEFI_YIELD',
          messageId: message.id,
          timestamp: Date.now(),
          yields: yields.slice(0, 5),
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in GET_DEFI_YIELD action');

      const errorMessage = error instanceof Error ? error.message : String(error);

      await callback({
        text: `利回り情報の取得に失敗しました: ${errorMessage}`,
        source: message.content.source,
      });

      return {
        text: 'Failed to get yield information',
        values: {
          success: false,
          error: errorMessage,
        },
        data: {
          actionName: 'GET_DEFI_YIELD',
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
          text: 'ステーブルコインで利回りを得る方法は？',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '💰 **ステーブルコインの利回り機会**\n\n1. **USDC** on Aave (Ethereum) 🟢 Stable\n   📊 APY: 8.5%\n   💎 TVL: $250M',
          actions: ['GET_DEFI_YIELD'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What are the best DeFi yields right now?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '💰 **Top DeFi Yield Opportunities**\n\n1. **ETH-USDC** on Uniswap V3 (Base)\n   📊 APY: 12.5%\n   💎 TVL: $50M',
          actions: ['GET_DEFI_YIELD'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Baseチェーンで運用できるプールは？',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '💰 **Baseの利回り機会**\n\n1. **USDC-USDbC** on Aerodrome (Base) 🟢 Stable\n   📊 APY: 15.2%\n   💎 TVL: $30M',
          actions: ['GET_DEFI_YIELD'],
        },
      },
    ],
  ],
};

/**
 * DeFi Yield Plugin
 * Provides DeFi yield farming and staking opportunity information
 */
export const deFiYieldPlugin: Plugin = {
  name: 'defi-yield',
  description: 'DeFi yield farming and staking opportunities from DeFiLlama',
  services: [DeFiYieldService],
  actions: [getDeFiYieldAction],
};

export default deFiYieldPlugin;
