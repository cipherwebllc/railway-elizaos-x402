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

export class ExchangeMonitorService extends Service {
  static serviceType = 'exchange-monitor';

  capabilityDescription = 'Monitors cryptocurrency exchange status and trading volumes';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('*** Starting Exchange Monitor service ***');
    const service = new ExchangeMonitorService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** Stopping Exchange Monitor service ***');
    const service = runtime.getService(ExchangeMonitorService.serviceType);
    if (service) {
      service.stop();
    }
  }

  async stop() {
    logger.info('*** Stopping Exchange Monitor service instance ***');
  }

  /**
   * Get exchange information from CoinGecko
   */
  async getExchangeInfo(exchangeId: string): Promise<any> {
    try {
      const url = `https://api.coingecko.com/api/v3/exchanges/${exchangeId}`;
      logger.info(`Fetching exchange info for ${exchangeId}`);

      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

      if (response.status === 429) {
        logger.warn(`CoinGecko API rate limit reached for ${exchangeId}`);
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      logger.error({ error }, `Error fetching exchange info for ${exchangeId}`);
      return null;
    }
  }

  /**
   * Get top exchanges by volume
   */
  async getTopExchanges(): Promise<any[]> {
    try {
      const url = 'https://api.coingecko.com/api/v3/exchanges?per_page=20';
      logger.info('Fetching top exchanges');

      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

      if (response.status === 429) {
        logger.warn('CoinGecko API rate limit reached for exchanges list');
        return this.getFallbackExchangeData();
      }

      const data = await response.json();
      return data.slice(0, 10);
    } catch (error) {
      logger.error({ error }, 'Error fetching top exchanges');
      return this.getFallbackExchangeData();
    }
  }

  /**
   * Get Japanese exchange information
   */
  getJapaneseExchanges(): any[] {
    return [
      {
        id: 'bitflyer',
        name: 'bitFlyer',
        country: 'Japan',
        description: '日本最大級の暗号資産取引所',
        features: [
          '金融庁登録済み（関東財務局長 第00003号）',
          'ビットコイン取引量国内No.1',
          'セキュリティ対策が充実',
          'サポートが日本語対応',
        ],
        trading_pairs: ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'MONA/JPY'],
        fees: {
          maker: '0.01% - 0.15%',
          taker: '0.01% - 0.15%',
        },
      },
      {
        id: 'coincheck',
        name: 'Coincheck',
        country: 'Japan',
        description: 'マネックスグループ運営の取引所',
        features: [
          '金融庁登録済み（関東財務局長 第00014号）',
          '初心者に使いやすいUI',
          '多様なアルトコインを取り扱い',
          'NFTマーケットプレイスあり',
        ],
        trading_pairs: ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'IOST/JPY'],
        fees: {
          maker: '0%',
          taker: '0%',
          spread: 'スプレッドあり（販売所）',
        },
      },
      {
        id: 'gmocoin',
        name: 'GMOコイン',
        country: 'Japan',
        description: 'GMOインターネットグループの取引所',
        features: [
          '金融庁登録済み（関東財務局長 第00006号）',
          '入出金手数料が無料',
          'レバレッジ取引対応（最大2倍）',
          'つみたて暗号資産サービス',
        ],
        trading_pairs: ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'DOT/JPY'],
        fees: {
          maker: '-0.01% - 0.05%',
          taker: '0.05% - 0.09%',
        },
      },
      {
        id: 'bitbank',
        name: 'bitbank',
        country: 'Japan',
        description: 'アルトコイン取引に強い取引所',
        features: [
          '金融庁登録済み（関東財務局長 第00004号）',
          'リップル取引量国内No.1',
          'セキュリティ評価が高い',
          'TradingViewのチャート採用',
        ],
        trading_pairs: ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY'],
        fees: {
          maker: '-0.02%',
          taker: '0.12%',
        },
      },
    ];
  }

  /**
   * Fallback exchange list when API is unavailable.
   * Returns names only — no volume or trust scores, since we cannot verify them live.
   */
  getFallbackExchangeData(): any[] {
    logger.warn('CoinGecko API unavailable — returning exchange names only (no live volume data)');
    return [
      {
        id: 'binance',
        name: 'Binance',
        country: 'Global',
        _fallback: true,
      },
      {
        id: 'coinbase-exchange',
        name: 'Coinbase Exchange',
        country: 'United States',
        _fallback: true,
      },
      {
        id: 'kraken',
        name: 'Kraken',
        country: 'United States',
        _fallback: true,
      },
    ];
  }
}

const getExchangeInfoAction: Action = {
  name: 'GET_EXCHANGE_INFO',
  similes: ['EXCHANGE', 'TRADING', 'VOLUME', 'CEX', 'MARKETPLACE'],
  description:
    'IMPORTANT: Use this action when the user asks about cryptocurrency exchanges, trading volumes, exchange status, or which exchange to use. Provides exchange information including Japanese exchanges.',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const text = message.content.text.toLowerCase();

    const exchangeKeywords = [
      'exchange',
      'trading',
      'volume',
      'binance',
      'coinbase',
      'kraken',
      'bitflyer',
      'coincheck',
      'gmo',
      'bitbank',
      '取引所',
      'トレード',
      '出来高',
    ];
    const queryKeywords = [
      'どこ',
      'where',
      'which',
      'best',
      'recommend',
      'おすすめ',
      '推奨',
      'status',
      'ステータス',
      '状況',
    ];

    const hasExchangeKeyword = exchangeKeywords.some((keyword) => text.includes(keyword));
    const hasQueryContext = queryKeywords.some((keyword) => text.includes(keyword)) || hasExchangeKeyword;

    return hasExchangeKeyword && hasQueryContext;
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
      logger.info('Handling GET_EXCHANGE_INFO action');

      const service = runtime.getService<ExchangeMonitorService>('exchange-monitor');

      if (!service) {
        throw new Error('Exchange Monitor service not available');
      }

      const text = message.content.text.toLowerCase();
      let responseText = '';
      let data: any = {};

      if (text.includes('japan') || text.includes('日本') || text.includes('国内')) {
        const jpExchanges = service.getJapaneseExchanges();
        data = { japanese_exchanges: jpExchanges };

        responseText = `🏦 **日本の暗号資産取引所**\n\n`;

        jpExchanges.forEach((exchange: any, index: number) => {
          responseText += `## ${index + 1}. ${exchange.name}\n`;
          responseText += `${exchange.description}\n\n`;
          responseText += `**特徴**:\n`;
          exchange.features.forEach((feature: string) => {
            responseText += `- ${feature}\n`;
          });
          responseText += `\n**主な取引ペア**: ${exchange.trading_pairs.join(', ')}\n`;
          responseText += `**手数料**: Maker ${exchange.fees.maker}, Taker ${exchange.fees.taker}\n\n`;
        });

        responseText += `\n💡 **選び方のポイント**:\n`;
        responseText += `- セキュリティ: 金融庁登録済みかを確認\n`;
        responseText += `- 手数料: 取引頻度に応じて最適な取引所を選択\n`;
        responseText += `- 取扱銘柄: 希望する暗号資産があるか確認\n`;
        responseText += `- UI/UX: 初心者は使いやすさを重視\n`;
      } else {
        // Global exchanges
        const exchanges = await service.getTopExchanges();
        data = { global_exchanges: exchanges };

        if (exchanges.length > 0) {
          responseText = `🌍 **グローバル取引所ランキング** (取引量順)\n\n`;

          const isFallback = exchanges.some((e: any) => e._fallback);

          if (isFallback) {
            responseText += `⚠️ _APIレート制限のため、リアルタイムデータは取得できませんでした。主要取引所の一覧のみ表示します。_\n\n`;
          }

          exchanges.slice(0, 5).forEach((exchange: any, index: number) => {
            responseText += `${index + 1}. **${exchange.name}**\n`;
            if (!isFallback) {
              const volume = exchange.trade_volume_24h_btc
                ? `${(exchange.trade_volume_24h_btc / 1000).toFixed(0)}K BTC`
                : 'N/A';
              const trustScore = exchange.trust_score || 'N/A';
              responseText += `   📊 24h取引量: ${volume}\n`;
              responseText += `   ⭐ Trust Score: ${trustScore}/10\n`;
            }
            if (exchange.country) {
              responseText += `   🌐 国: ${exchange.country}\n`;
            }
            responseText += `\n`;
          });
        } else {
          responseText = `🌍 **主要グローバル取引所**\n\n`;
          responseText += `1. **Binance**: 世界最大の取引所\n`;
          responseText += `2. **Coinbase**: 米国最大の取引所（規制準拠）\n`;
          responseText += `3. **Kraken**: セキュリティに定評\n\n`;
        }

        responseText += `\n⚠️ **海外取引所の注意点**:\n`;
        responseText += `- 日本居住者は利用制限がある場合があります\n`;
        responseText += `- 送金時の税務処理が複雑になります\n`;
        responseText += `- 日本語サポートがない場合があります\n`;
      }

      await callback({
        text: responseText,
        actions: ['GET_EXCHANGE_INFO'],
        source: message.content.source,
      });

      return {
        text: 'Successfully retrieved exchange information',
        values: {
          success: true,
        },
        data: {
          actionName: 'GET_EXCHANGE_INFO',
          messageId: message.id,
          timestamp: Date.now(),
          ...data,
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in GET_EXCHANGE_INFO action');

      const errorMessage = error instanceof Error ? error.message : String(error);

      await callback({
        text: `取引所情報の取得に失敗しました: ${errorMessage}`,
        source: message.content.source,
      });

      return {
        text: 'Failed to get exchange information',
        values: {
          success: false,
          error: errorMessage,
        },
        data: {
          actionName: 'GET_EXCHANGE_INFO',
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
          text: '日本のおすすめ取引所は？',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '🏦 **日本の暗号資産取引所**\n\n## 1. bitFlyer\n日本最大級の暗号資産取引所\n\n**特徴**:\n- 金融庁登録済み\n- ビットコイン取引量国内No.1',
          actions: ['GET_EXCHANGE_INFO'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Which exchange has the highest volume?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '🌍 **Global Exchange Rankings**\n\n1. **Binance**\n   📊 24h Volume: 500K BTC\n   ⭐ Trust Score: 10/10',
          actions: ['GET_EXCHANGE_INFO'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'bitFlyerとCoincheckの違いは？',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '🏦 **日本の暗号資産取引所**\n\n## 1. bitFlyer\nビットコイン取引量が多く、中級者向け\n\n## 2. Coincheck\n初心者に使いやすいUI、NFTマーケットプレイスあり',
          actions: ['GET_EXCHANGE_INFO'],
        },
      },
    ],
  ],
};

export const exchangeMonitorPlugin: Plugin = {
  name: 'exchange-monitor',
  description: 'Cryptocurrency exchange information and monitoring',
  services: [ExchangeMonitorService],
  actions: [getExchangeInfoAction],
};

export default exchangeMonitorPlugin;
