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
 * News Service
 * Provides real-time cryptocurrency news from multiple sources
 */
export class NewsService extends Service {
  static serviceType = 'news';

  capabilityDescription = 'Fetches real-time cryptocurrency news and updates';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('*** Starting News service ***');
    const service = new NewsService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** Stopping News service ***');
    const service = runtime.getService(NewsService.serviceType);
    if (service) {
      service.stop();
    }
  }

  async stop() {
    logger.info('*** Stopping News service instance ***');
  }

  /**
   * Get crypto news from CryptoCompare (Free, no API key required)
   */
  async getCryptoCompareNews(): Promise<any[]> {
    try {
      const url = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN';

      logger.info('Fetching crypto news from CryptoCompare');

      const response = await fetch(url);
      const data = await response.json();

      if (data.Data) {
        logger.info(`Retrieved ${data.Data.length} news articles`);
        return data.Data.slice(0, 10); // Top 10 articles
      }
      return [];
    } catch (error) {
      logger.error({ error }, 'Error fetching from CryptoCompare');
      return [];
    }
  }
}

/**
 * Get Crypto News Action
 * Fetches latest cryptocurrency news
 */
const getCryptoNewsAction: Action = {
  name: 'GET_CRYPTO_NEWS',
  similes: ['NEWS', 'LATEST_NEWS', 'CRYPTO_NEWS', 'HEADLINES', 'UPDATES'],
  description: 'Get latest cryptocurrency news and headlines',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const text = message.content.text.toLowerCase();

    const newsKeywords = ['news', 'latest', 'headlines', 'articles', 'updates', 'happening'];
    const cryptoKeywords = ['crypto', 'bitcoin', 'ethereum', 'btc', 'eth', 'cryptocurrency', 'coin', 'market'];

    const hasNewsKeyword = newsKeywords.some(keyword => text.includes(keyword));
    const hasCryptoKeyword = cryptoKeywords.some(keyword => text.includes(keyword));

    return hasNewsKeyword || (hasCryptoKeyword && text.includes('what'));
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
      logger.info('Handling GET_CRYPTO_NEWS action');

      const service = runtime.getService<NewsService>('news');

      if (!service) {
        throw new Error('News service not available');
      }

      // Fetch news
      const news = await service.getCryptoCompareNews();

      if (news.length === 0) {
        await callback({
          text: '申し訳ございません。現在ニュースを取得できません。',
          source: message.content.source,
        });

        return {
          text: 'No news available',
          values: { success: false },
          data: { actionName: 'GET_CRYPTO_NEWS' },
          success: false,
        };
      }

      // Format response
      let responseText = `📰 最新の暗号通貨ニュース (${news.length}件):\n\n`;

      news.slice(0, 5).forEach((article: any, index: number) => {
        const title = article.title || 'タイトルなし';
        const source = article.source_info?.name || article.source || '不明';
        const url = article.url || article.guid || '';
        const publishedAt = article.published_on
          ? new Date(article.published_on * 1000).toLocaleString('ja-JP')
          : '日時不明';

        responseText += `${index + 1}. **${title}**\n`;
        responseText += `   📅 ${publishedAt}\n`;
        responseText += `   📰 出典: ${source}\n`;
        if (url) responseText += `   🔗 ${url}\n`;
        responseText += '\n';
      });

      responseText += `\n💡 さらに詳しい情報は各リンクをご覧ください。`;

      const responseContent: Content = {
        text: responseText,
        actions: ['GET_CRYPTO_NEWS'],
        source: message.content.source,
      };

      await callback(responseContent);

      return {
        text: `Successfully retrieved ${news.length} news articles`,
        values: {
          success: true,
          count: news.length,
        },
        data: {
          actionName: 'GET_CRYPTO_NEWS',
          messageId: message.id,
          timestamp: Date.now(),
          news: news.slice(0, 5),
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in GET_CRYPTO_NEWS action');

      const errorMessage = error instanceof Error ? error.message : String(error);

      await callback({
        text: `ニュースの取得に失敗しました: ${errorMessage}`,
        source: message.content.source,
      });

      return {
        text: 'Failed to get news',
        values: {
          success: false,
          error: errorMessage,
        },
        data: {
          actionName: 'GET_CRYPTO_NEWS',
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
        name: '{{name1}}',
        content: {
          text: '最新の暗号通貨ニュースを教えて',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '📰 最新の暗号通貨ニュース (5件):\n\n1. **Bitcoin Reaches New High**\n   📅 2024-01-15 10:30:00\n   📰 出典: CoinDesk\n   🔗 https://...',
          actions: ['GET_CRYPTO_NEWS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'What is the latest crypto news?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '📰 最新の暗号通貨ニュース (5件):\n\n1. **Ethereum Upgrade Announced**\n   📅 2024-01-15 09:15:00\n   📰 出典: Cointelegraph\n   🔗 https://...',
          actions: ['GET_CRYPTO_NEWS'],
        },
      },
    ],
  ],
};

/**
 * News Plugin
 * Provides real-time cryptocurrency news functionality
 */
export const newsPlugin: Plugin = {
  name: 'news',
  description: 'Real-time cryptocurrency news integration (CryptoCompare API)',
  services: [NewsService],
  actions: [getCryptoNewsAction],
};

export default newsPlugin;
