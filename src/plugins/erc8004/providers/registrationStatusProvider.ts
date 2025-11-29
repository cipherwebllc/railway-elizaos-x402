import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { ERC8004Service } from '../service';
import { ERC8004_SERVICE_NAME } from '../constants';

/**
 * Registration Status Provider
 * 
 * Provides ERC-8004 registration status information to the agent's context.
 * This helps the LLM understand whether the agent is registered on-chain and
 * what actions are available.
 */
export const registrationStatusProvider: Provider = {
    name: 'ERC8004_REGISTRATION_STATUS',
    description: 'Provides ERC-8004 on-chain registration status and availability information',

    get: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state: State | undefined
    ): Promise<ProviderResult> => {
        try {
            const service = runtime.getService<ERC8004Service>(ERC8004_SERVICE_NAME);
            if (!service) {
                return {
                    text: 'ERC-8004 service not available. Install @elizaos/plugin-8004 to enable on-chain registration.',
                    values: {
                        serviceAvailable: false,
                        registered: false,
                    },
                    data: {
                        serviceAvailable: false,
                        registered: false,
                    },
                };
            }

            // Get agent ID - prefer character name over runtime UUID
            const agentId = runtime.character?.name?.toLowerCase().replace(/\s+/g, '-') || runtime.agentId;
            const walletAddress = service.getWalletAddress();
            const canWrite = service.canWrite();
            const contract = service.getContract();

            // Get all registries and check registration status across them
            const registryManager = service.getRegistryManager();
            const registries = await registryManager.getRegistries();
            const registrationResults = await service.checkAgentAcrossRegistries(agentId);

            // Count registrations
            const registeredRegistries: Array<{ registryId: string; registryName: string; agentInfo: any; isActive: boolean; reputation: string }> = [];
            const unregisteredRegistries: Array<{ registryId: string; registryName: string }> = [];

            for (const registry of registries) {
                const result = registrationResults.get(registry.id);
                if (result?.registered && result.agentInfo) {
                    registeredRegistries.push({
                        registryId: registry.id,
                        registryName: registry.name,
                        agentInfo: result.agentInfo,
                        isActive: result.isActive,
                        reputation: result.reputation ? service.formatReputation(result.reputation.score) : '0',
                    });
                } else {
                    unregisteredRegistries.push({
                        registryId: registry.id,
                        registryName: registry.name,
                    });
                }
            }

            const totalRegistries = registries.length;
            const registeredCount = registeredRegistries.length;
            const unregisteredCount = unregisteredRegistries.length;

            // Build status text
            let text = `ERC-8004 Registration Status:\n\n`;
            text += `Registered in ${registeredCount} of ${totalRegistries} registries.\n\n`;

            if (registeredRegistries.length > 0) {
                text += `**Registered Registries:**\n`;
                for (const reg of registeredRegistries) {
                    text += `- ${reg.registryName} (${reg.registryId}): Registered, ${reg.isActive ? 'Active' : 'Inactive'}, Reputation: ${reg.reputation}\n`;
                }
                text += `\n`;
            }

            if (unregisteredRegistries.length > 0) {
                text += `**Not Registered In:**\n`;
                for (const reg of unregisteredRegistries) {
                    text += `- ${reg.registryName} (${reg.registryId}): NOT registered\n`;
                }
                text += `\n`;
            }

            text += `**Configuration:**\n`;
            text += `- Agent ID: ${agentId}\n`;
            text += `- Wallet: ${walletAddress || 'Not configured'}\n`;
            text += `- Write Mode: ${canWrite ? 'Enabled' : 'Read-only'}\n`;
            text += `\n`;

            if (unregisteredCount > 0) {
                text += `Use REGISTER_AGENT_ERC8004 to register in a specific registry.\n`;
            }
            text += `Use ADD_REGISTRY_ERC8004 to add more registries.\n`;
            text += `Use LIST_REGISTRIES_ERC8004 to see all configured registries.`;

            return {
                text,
                values: {
                    serviceAvailable: true,
                    totalRegistries,
                    registeredCount,
                    unregisteredCount,
                    registered: registeredCount > 0,
                    canWrite,
                    agentId,
                    walletAddress: walletAddress || null,
                    canRegister: canWrite,
                },
                data: {
                    serviceAvailable: true,
                    totalRegistries,
                    registeredCount,
                    unregisteredCount,
                    registered: registeredCount > 0,
                    registeredRegistries,
                    unregisteredRegistries,
                    canWrite,
                    agentId,
                    walletAddress: walletAddress || null,
                    canRegister: canWrite,
                },
            };
        } catch (error) {
            logger.error({ error }, 'Error in registrationStatusProvider:');
            return {
                text: 'Error fetching ERC-8004 registration status',
                values: {
                    error: error instanceof Error ? error.message : String(error),
                },
                data: {
                    error: error instanceof Error ? error.message : String(error),
                },
            };
        }
    },
};

