import type { ElizaOS, UUID } from '@elizaos/core';
/**
 * Validates and retrieves an agent runtime from the agents map
 */
export declare const getRuntime: (elizaOS: ElizaOS, agentId: UUID) => import("@elizaos/core").IAgentRuntime;
/**
 * Validates a UUID parameter and returns it as UUID type or null if invalid
 */
export declare const validateAgentId: (agentId: string) => UUID | null;
/**
 * Validates a room ID parameter
 */
export declare const validateRoomId: (roomId: string) => UUID | null;
/**
 * Enhanced channel ID validation with security logging
 * Validates a channel ID parameter with additional security checks
 */
export declare const validateChannelId: (channelId: string, clientIp?: string) => UUID | null;
/**
 * Validates a memory ID parameter
 */
export declare const validateMemoryId: (memoryId: string) => UUID | null;
/**
 * Validates a world ID parameter
 */
export declare const validateWorldId: (worldId: string) => UUID | null;
