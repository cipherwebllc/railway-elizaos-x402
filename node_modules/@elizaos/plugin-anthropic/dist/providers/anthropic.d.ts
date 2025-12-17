import type { IAgentRuntime } from '@elizaos/core';
/**
 * Create an Anthropic client with proper configuration
 *
 * @param runtime The runtime context
 * @returns Configured Anthropic client
 */
export declare function createAnthropicClient(runtime: IAgentRuntime): import("@ai-sdk/anthropic").AnthropicProvider;
