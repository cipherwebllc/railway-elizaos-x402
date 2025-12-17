import { Service } from '@elizaos/core';
/**
 * A standardized representation of a token holding.
 */
export interface TokenBalance {
    address: string;
    balance: string;
    decimals: number;
    uiAmount?: number;
    name?: string;
    symbol?: string;
    logoURI?: string;
}
/**
 * Generic representation of token data that can be provided by various services.
 */
export interface TokenData {
    id: string;
    symbol: string;
    name: string;
    address: string;
    chain: string;
    sourceProvider: string;
    price?: number;
    priceChange24hPercent?: number;
    priceChange24hUSD?: number;
    volume24hUSD?: number;
    marketCapUSD?: number;
    liquidity?: number;
    holders?: number;
    logoURI?: string;
    decimals?: number;
    lastUpdatedAt?: Date;
    raw?: any;
}
/**
 * Interface for a generic service that provides token data.
 */
export declare abstract class ITokenDataService extends Service {
    static readonly serviceType: "token_data";
    readonly capabilityDescription: string;
    /**
     * Fetches detailed information for a single token.
     * @param address The token's contract address.
     * @param chain The blockchain the token resides on.
     * @returns A Promise resolving to TokenData or null if not found.
     */
    abstract getTokenDetails(address: string, chain: string): Promise<TokenData | null>;
    /**
     * Fetches a list of trending tokens.
     * @param chain Optional: Filter by a specific blockchain.
     * @param limit Optional: Number of tokens to return. Defaults to a service-specific value.
     * @param timePeriod Optional: Time period for trending data (e.g., '24h', '7d'). Defaults to service-specific.
     * @returns A Promise resolving to an array of TokenData.
     */
    abstract getTrendingTokens(chain?: string, limit?: number, timePeriod?: string): Promise<TokenData[]>;
    /**
     * Searches for tokens based on a query string.
     * @param query The search query (e.g., symbol, name, address).
     * @param chain Optional: Filter by a specific blockchain.
     * @param limit Optional: Number of results to return.
     * @returns A Promise resolving to an array of TokenData.
     */
    abstract searchTokens(query: string, chain?: string, limit?: number): Promise<TokenData[]>;
    /**
     * Fetches data for multiple tokens by their addresses on a specific chain.
     * @param addresses Array of token contract addresses.
     * @param chain The blockchain the tokens reside on.
     * @returns A Promise resolving to an array of TokenData. May not include all requested if some are not found.
     */
    abstract getTokensByAddresses(addresses: string[], chain: string): Promise<TokenData[]>;
}
