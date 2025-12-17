import type { IAgentRuntime } from '@elizaos/core';
/**
 * Retrieves a configuration setting from the runtime, falling back to environment variables or a default value if not found.
 *
 * @param key - The name of the setting to retrieve.
 * @param defaultValue - The value to return if the setting is not found in the runtime or environment.
 * @returns The resolved setting value, or {@link defaultValue} if not found.
 */
export declare function getSetting(runtime: IAgentRuntime, key: string, defaultValue?: string): string | undefined;
/**
 * Check if we're running in a browser environment
 */
export declare function isBrowser(): boolean;
/**
 * Retrieves the Anthropic API base URL from runtime settings, environment variables, or defaults.
 *
 * @returns The resolved base URL for Anthropic API requests.
 */
export declare function getBaseURL(runtime: IAgentRuntime): string;
/**
 * Helper function to get the API key for Anthropic
 *
 * @param runtime The runtime context
 * @returns The configured API key
 */
export declare function getApiKey(runtime: IAgentRuntime): string | undefined;
/**
 * Helper function to get the small model name with fallbacks
 *
 * @param runtime The runtime context
 * @returns The configured small model name
 */
export declare function getSmallModel(runtime: IAgentRuntime): string;
/**
 * Helper function to get the large model name with fallbacks
 *
 * @param runtime The runtime context
 * @returns The configured large model name
 */
export declare function getLargeModel(runtime: IAgentRuntime): string;
/**
 * Helper function to get experimental telemetry setting
 *
 * @param runtime The runtime context
 * @returns Whether experimental telemetry is enabled
 */
export declare function getExperimentalTelemetry(runtime: IAgentRuntime): boolean;
