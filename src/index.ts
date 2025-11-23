import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import { coinGeckoPlugin } from './coingecko-plugin.ts';
import { newsPlugin } from './news-plugin.ts';
import { character } from './character.ts';

const initCharacter = () => {
  logger.info('Initializing character');
  logger.info({ name: character.name }, 'Name:');
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (_runtime: IAgentRuntime) => initCharacter(),
  plugins: [
    coinGeckoPlugin,  // CoinGecko plugin for crypto price data
    newsPlugin,       // News plugin for real-time crypto news
  ],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from './character.ts';

export default project;
