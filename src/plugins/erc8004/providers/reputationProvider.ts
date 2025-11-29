import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { ERC8004Service } from '../service';
import { ERC8004_SERVICE_NAME } from '../constants';

/**
 * Reputation Provider
 * 
 * Provides ERC-8004 reputation information across all configured registries.
 * Shows reputation scores, active status, and registration details for each registry.
 */
export const reputationProvider: Provider = {
    name: 'REPUTATION_PROVIDER',
    description: 'Provides reputation context from ERC-8004 on-chain registries across all configured registries',

    get: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state: State | undefined
    ): Promise<ProviderResult> => {
        try {
            const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
            if (!service) {
                return {
                    text: '',
                    values: {
                        registered: false,
                    },
                    data: {
                        registered: false,
                    },
                };
            }

            // Get agent ID - prefer character name over runtime UUID (for ERC-8004, we use string IDs, not UUIDs)
            const agentId = runtime.character?.name?.toLowerCase().replace(/\s+/g, '-') || runtime.agentId;

            // Get all registries and check reputation across them
            const registryManager = service.getRegistryManager();
            const registries = await registryManager.getRegistries();
            const registrationResults = await service.checkAgentAcrossRegistries(agentId);

            // Collect reputation data from all registries
            const reputationData: Array<{
                registryId: string;
                registryName: string;
                agentInfo: any;
                isActive: boolean;
                reputation: string;
                reputationScore: bigint;
                lastUpdate: string;
            }> = [];

            for (const registry of registries) {
                const result = registrationResults.get(registry.id);
                if (result?.registered && result.agentInfo && result.reputation) {
                    const lastUpdateDate = result.agentInfo.lastUpdate
                        ? new Date(Number(result.agentInfo.lastUpdate) * 1000).toISOString()
                        : 'Unknown';

                    reputationData.push({
                        registryId: registry.id,
                        registryName: registry.name,
                        agentInfo: result.agentInfo,
                        isActive: result.isActive,
                        reputation: service.formatReputation(result.reputation.score),
                        reputationScore: result.reputation.score,
                        lastUpdate: lastUpdateDate,
                    });
                }
            }

            // If no reputation found in any registry
            if (reputationData.length === 0) {
                return {
                    text: 'Agent not registered in any ERC-8004 reputation registry.',
                    values: {
                        registered: false,
                        agentId,
                    },
                    data: {
                        registered: false,
                        agentId,
                        registries: registries.length,
                    },
                };
            }

            // Build reputation text across all registries
            let text = `ERC-8004 Reputation Status (${reputationData.length} of ${registries.length} registries):\n\n`;

            // Sort by reputation score (highest first)
            const sortedReputation = [...reputationData].sort((a, b) => {
                if (a.reputationScore > b.reputationScore) return -1;
                if (a.reputationScore < b.reputationScore) return 1;
                return 0;
            });

            for (const rep of sortedReputation) {
                text += `**${rep.registryName}** (${rep.registryId}):\n`;
                text += `- Name: ${rep.agentInfo.name}\n`;
                text += `- Domain: ${rep.agentInfo.domain}\n`;
                text += `- Status: ${rep.isActive ? 'Active' : 'Inactive'}\n`;
                text += `- Reputation Score: ${rep.reputation}\n`;
                text += `- Last Updated: ${rep.lastUpdate}\n`;
                text += `- Owner: ${rep.agentInfo.owner}\n\n`;
            }

            // Calculate aggregate stats
            const totalReputation = reputationData.reduce((sum, rep) => sum + rep.reputationScore, BigInt(0));
            const avgReputation = reputationData.length > 0
                ? totalReputation / BigInt(reputationData.length)
                : BigInt(0);
            const activeCount = reputationData.filter((rep) => rep.isActive).length;

            text += `**Summary:**\n`;
            text += `- Total Registries: ${registries.length}\n`;
            text += `- Registered In: ${reputationData.length}\n`;
            text += `- Active Registrations: ${activeCount}\n`;
            text += `- Average Reputation: ${service.formatReputation(avgReputation)}\n`;
            text += `- Total Reputation: ${service.formatReputation(totalReputation)}`;

            return {
                text,
                values: {
                    registered: true,
                    agentId,
                    totalRegistries: registries.length,
                    registeredCount: reputationData.length,
                    activeCount,
                    averageReputation: service.formatReputation(avgReputation),
                    totalReputation: service.formatReputation(totalReputation),
                },
                data: {
                    registered: true,
                    agentId,
                    reputationData,
                    totalRegistries: registries.length,
                    registeredCount: reputationData.length,
                    activeCount,
                    averageReputation: avgReputation,
                    totalReputation,
                },
            };
        } catch (error) {
            logger.error({ error }, 'Error in reputationProvider:');
            return {
                text: 'Error fetching reputation data',
                values: {},
                data: { error: error instanceof Error ? error.message : String(error) },
            };
        }
    },
};

