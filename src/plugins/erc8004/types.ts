import type { IAgentRuntime } from '@elizaos/core';

export interface ERC8004Config {
    rpcUrl?: string;
    chainId?: number;
    contractAddress: string;
    privateKey?: string;
}

export interface AgentInfo {
    owner: string;
    name: string;
    domain: string;
    active: boolean;
    reputation: bigint;
    lastUpdate: bigint;
}

export interface AgentRegistration {
    agentId: string;
    name: string;
    domain: string;
}

export interface AgentEndorsement {
    agentId: string;
    amount: bigint;
}

export interface AgentReport {
    agentId: string;
    reason: string;
}

export interface TransactionResult {
    success: boolean;
    transactionHash?: string;
    error?: string;
}

export interface ReputationScore {
    agentId: string;
    score: bigint;
    timestamp: number;
}

export type ChainId = 31337 | 1 | 8453 | 11155111 | 84532;

export interface ERC8004Registry {
    id: string; // e.g., 'babylon-base-sepolia'
    name: string; // e.g., 'Babylon (Base Sepolia)'
    chainId: number;
    contractAddress: string;
    rpcUrl?: string;
    isDefault: boolean;
    handlerType?: string; // 'babylon', 'standard', etc. (default: 'standard')
}

export interface RegistrationParam {
    name: string;
    description: string;
    required: boolean;
    default?: string;
}

export interface RegistrationHandler {
    type: string; // e.g., 'babylon', 'standard'
    requiredParams: RegistrationParam[];
    register: (runtime: IAgentRuntime, params: Record<string, any>) => Promise<TransactionResult>;
    validate?: (params: Record<string, any>) => boolean;
}

