import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type Provider,
  type ProviderResult,
  Service,
  type State,
  logger,
} from '@elizaos/core';
import { z } from 'zod';

/**
 * CoinGecko API Service
 * Provides cryptocurrency price data using CoinGecko's free API
 */
export class CoinGeckoService extends Service {
  static serviceType = 'coingecko';
  private baseUrl = 'https://api.coingecko.com/api/v3';

  capabilityDescription =
    'Provides real-time cryptocurrency price data from CoinGecko API';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('*** Starting CoinGecko service ***');
    const service = new CoinGeckoService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** Stopping CoinGecko service ***');
    const service = runtime.getService(CoinGeckoService.serviceType);
    if (service) {
      service.stop();
    }
  }

  async stop() {
    logger.info('*** Stopping CoinGecko service instance ***');
  }

  /**
   * Get current price for a cryptocurrency
   * @param coinId - CoinGecko coin ID (e.g., 'bitcoin', 'ethereum')
   * @param vsCurrency - Target currency (default: 'usd')
   */
  async getPrice(coinId: string, vsCurrency: string = 'usd'): Promise<any> {
    try {
      const url = `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=${vsCurrency}&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`;

      logger.info(`Fetching price for ${coinId} in ${vsCurrency}`);

      const response = await fetch(url);

      if (!response.ok) {
        // If rate limited (429), just log warning and return null instead of throwing
        if (response.status === 429) {
          logger.warn(`CoinGecko API rate limit reached for ${coinId}, skipping price fetch`);
          return null;
        }
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data[coinId]) {
        logger.warn(`No data found for coin: ${coinId}`);
        return null;
      }

      return data[coinId];
    } catch (error) {
      logger.error({ error, coinId, vsCurrency }, 'Error fetching price from CoinGecko');
      // Return null instead of throwing to prevent crashes
      return null;
    }
  }

  /**
   * Get detailed coin data including price, market cap, volume, etc.
   * @param coinId - CoinGecko coin ID
   */
  async getCoinData(coinId: string): Promise<any> {
    try {
      const url = `${this.baseUrl}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;

      logger.info(`Fetching detailed data for ${coinId}`);

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 429) {
          logger.warn(`CoinGecko API rate limit reached for ${coinId}, skipping coin data fetch`);
          return null;
        }
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      logger.error({ error, coinId }, 'Error fetching coin data from CoinGecko');
      return null;
    }
  }

  /**
   * Search for coins by name or symbol
   * @param query - Search query
   */
  async searchCoins(query: string): Promise<any> {
    try {
      const url = `${this.baseUrl}/search?query=${encodeURIComponent(query)}`;

      logger.info(`Searching for: ${query}`);

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 429) {
          logger.warn(`CoinGecko API rate limit reached for query ${query}, skipping search`);
          return null;
        }
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      logger.error({ error, query }, 'Error searching coins on CoinGecko');
      return null;
    }
  }
}

/**
 * Get Crypto Price Action
 * Fetches current cryptocurrency prices from CoinGecko
 */
const getCryptoPriceAction: Action = {
  name: 'GET_CRYPTO_PRICE',
  similes: ['CHECK_PRICE', 'CRYPTO_PRICE', 'GET_PRICE', 'PRICE_CHECK', 'BTC_PRICE', 'ETH_PRICE'],
  description: 'Get current cryptocurrency price from CoinGecko',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const text = message.content.text.toLowerCase();

    // Check for price-related keywords and cryptocurrency mentions
    const priceKeywords = ['price', 'cost', 'worth', 'value', 'how much'];
    const cryptoKeywords = ['btc', 'bitcoin', 'eth', 'ethereum', 'crypto', 'coin', 'token'];

    const hasPriceKeyword = priceKeywords.some(keyword => text.includes(keyword));
    const hasCryptoKeyword = cryptoKeywords.some(keyword => text.includes(keyword));

    return hasPriceKeyword && hasCryptoKeyword;
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
      logger.info('Handling GET_CRYPTO_PRICE action');

      const service = runtime.getService<CoinGeckoService>('coingecko');

      if (!service) {
        throw new Error('CoinGecko service not available');
      }

      const text = message.content.text.toLowerCase();

      // Extract coin from message
      let coinId = 'bitcoin'; // default
      let coinName = 'Bitcoin';

      if (text.includes('btc') || text.includes('bitcoin')) {
        coinId = 'bitcoin';
        coinName = 'Bitcoin';
      } else if (text.includes('eth') || text.includes('ethereum')) {
        coinId = 'ethereum';
        coinName = 'Ethereum';
      } else if (text.includes('sol') || text.includes('solana')) {
        coinId = 'solana';
        coinName = 'Solana';
      } else if (text.includes('usdt') || text.includes('tether')) {
        coinId = 'tether';
        coinName = 'Tether';
      } else if (text.includes('bnb') || text.includes('binance')) {
        coinId = 'binancecoin';
        coinName = 'BNB';
      } else if (text.includes('xrp') || text.includes('ripple')) {
        coinId = 'ripple';
        coinName = 'XRP';
      } else if (text.includes('ada') || text.includes('cardano')) {
        coinId = 'cardano';
        coinName = 'Cardano';
      } else if (text.includes('doge') || text.includes('dogecoin')) {
        coinId = 'dogecoin';
        coinName = 'Dogecoin';
      }

      // Fetch price data
      const priceData = await service.getPrice(coinId, 'usd');

      // Check if price data is available
      if (!priceData) {
        await callback({
          text: `Sorry, ${coinName} price data is temporarily unavailable. Please try again later.`,
          source: message.content.source,
        });

        return {
          text: 'Price data unavailable',
          values: { success: false, reason: 'rate_limited' },
          data: {},
          success: false,
        };
      }

      // Format response
      const price = priceData.usd;
      const marketCap = priceData.usd_market_cap;
      const volume24h = priceData.usd_24h_vol;
      const change24h = priceData.usd_24h_change;
      const lastUpdated = new Date(priceData.last_updated_at * 1000);

      const changeEmoji = change24h >= 0 ? '📈' : '📉';
      const changeSign = change24h >= 0 ? '+' : '';

      const responseText = `${coinName} (${coinId.toUpperCase()}) Price Data:\n\n` +
        `💰 Price: $${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
        `${changeEmoji} 24h Change: ${changeSign}${change24h.toFixed(2)}%\n` +
        `📊 Market Cap: $${(marketCap / 1e9).toFixed(2)}B\n` +
        `💵 24h Volume: $${(volume24h / 1e9).toFixed(2)}B\n` +
        `⏰ Last Updated: ${lastUpdated.toLocaleString()}`;

      const responseContent: Content = {
        text: responseText,
        actions: ['GET_CRYPTO_PRICE'],
        source: message.content.source,
      };

      await callback(responseContent);

      return {
        text: `Successfully retrieved ${coinName} price`,
        values: {
          success: true,
          coinId,
          coinName,
          price,
          change24h,
          marketCap,
          volume24h,
        },
        data: {
          actionName: 'GET_CRYPTO_PRICE',
          messageId: message.id,
          timestamp: Date.now(),
          priceData,
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in GET_CRYPTO_PRICE action');

      const errorMessage = error instanceof Error ? error.message : String(error);

      await callback({
        text: `Failed to get cryptocurrency price: ${errorMessage}`,
        source: message.content.source,
      });

      return {
        text: 'Failed to get cryptocurrency price',
        values: {
          success: false,
          error: errorMessage,
        },
        data: {
          actionName: 'GET_CRYPTO_PRICE',
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
          text: 'What is the current price of Bitcoin?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Bitcoin (BITCOIN) Price Data:\n\n💰 Price: $43,521.00\n📈 24h Change: +2.34%\n📊 Market Cap: $851.23B\n💵 24h Volume: $28.45B\n⏰ Last Updated: 2024-01-15 10:30:00',
          actions: ['GET_CRYPTO_PRICE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'How much is ETH worth?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Ethereum (ETHEREUM) Price Data:\n\n💰 Price: $2,543.12\n📈 24h Change: +1.23%\n📊 Market Cap: $305.67B\n💵 24h Volume: $15.89B\n⏰ Last Updated: 2024-01-15 10:30:00',
          actions: ['GET_CRYPTO_PRICE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Check BTC price',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Bitcoin (BITCOIN) Price Data:\n\n💰 Price: $43,521.00\n📈 24h Change: +2.34%\n📊 Market Cap: $851.23B\n💵 24h Volume: $28.45B\n⏰ Last Updated: 2024-01-15 10:30:00',
          actions: ['GET_CRYPTO_PRICE'],
        },
      },
    ],
  ],
};

/**
 * Crypto Price Provider
 * Provides current crypto prices in the agent's context
 */
const cryptoPriceProvider: Provider = {
  name: 'CRYPTO_PRICE_PROVIDER',
  description: 'Provides current cryptocurrency market prices',

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    try {
      const service = runtime.getService<CoinGeckoService>('coingecko');

      if (!service) {
        return {
          text: 'CoinGecko service not available',
          values: {},
          data: {},
        };
      }

      // Get prices for major cryptocurrencies
      const coins = ['bitcoin', 'ethereum', 'solana'];
      const prices: Record<string, any> = {};

      for (const coin of coins) {
        try {
          const price = await service.getPrice(coin, 'usd');
          if (price) {
            prices[coin] = price;
          }
        } catch (error) {
          logger.error({ error, coin }, 'Error fetching price for coin');
        }
      }

      // Only include coins with valid price data
      const priceText = Object.entries(prices)
        .filter(([_, data]) => data && data.usd)
        .map(([coin, data]) => `${coin}: $${data.usd.toLocaleString()}`)
        .join(', ');

      if (!priceText) {
        return {
          text: 'Crypto price data temporarily unavailable',
          values: {},
          data: {},
        };
      }

      return {
        text: `Current crypto prices: ${priceText}`,
        values: prices,
        data: { lastUpdated: Date.now() },
      };
    } catch (error) {
      logger.error({ error }, 'Error in CRYPTO_PRICE_PROVIDER');
      return {
        text: 'Unable to fetch crypto prices',
        values: {},
        data: {},
      };
    }
  },
};

/**
 * CoinGecko Plugin
 * Main plugin export that integrates CoinGecko functionality into ElizaOS
 */
export const coinGeckoPlugin: Plugin = {
  name: 'coingecko',
  description: 'CoinGecko cryptocurrency price data integration',
  services: [CoinGeckoService],
  actions: [getCryptoPriceAction],
  providers: [cryptoPriceProvider],
};

export default coinGeckoPlugin;
