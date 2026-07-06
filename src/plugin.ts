import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
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

const configSchema = z.object({
  EXAMPLE_PLUGIN_VARIABLE: z
    .string()
    .min(1, 'Example plugin variable is not provided')
    .optional()
    .transform((val) => {
      if (!val) {
        logger.warn('Example plugin variable is not provided');
      }
      return val;
    }),
});

const helloWorldAction: Action = {
  name: 'HELLO_WORLD',
  similes: ['GREET', 'SAY_HELLO'],
  description: 'Responds with a simple hello world message',

  validate: async (_runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const text = (message.content.text || '').toLowerCase();
    const greetingKeywords = ['hello', 'hi', 'hey', 'greet', 'good morning', 'good evening', 'howdy'];
    return greetingKeywords.some(keyword => text.includes(keyword));
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Handling HELLO_WORLD action');

      await callback({
        text: 'hello world!',
        actions: ['HELLO_WORLD'],
        source: message.content.source,
      });

      return {
        text: 'Sent hello world greeting',
        values: {
          success: true,
          greeted: true,
        },
        data: {
          actionName: 'HELLO_WORLD',
          messageId: message.id,
          timestamp: Date.now(),
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in HELLO_WORLD action:');
      return {
        text: 'Failed to send hello world greeting',
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Can you say hello?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'hello world!',
          actions: ['HELLO_WORLD'],
        },
      },
    ],
  ],
};

const helloWorldProvider: Provider = {
  name: 'HELLO_WORLD_PROVIDER',
  description: 'A simple example provider that reports starter plugin status',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    return {
      text: 'Starter plugin is active.',
      values: {
        starterPluginActive: true,
      },
      data: {
        pluginName: 'starter',
        loadedAt: Date.now(),
      },
    };
  },
};

export class StarterService extends Service {
  static serviceType = 'starter';
  capabilityDescription =
    'This is a starter service which is attached to the agent through the starter plugin.';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('*** Starting starter service ***');
    const service = new StarterService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** Stopping starter service ***');
    const service = runtime.getService(StarterService.serviceType);
    if (!service) {
      throw new Error('Starter service not found');
    }
    service.stop();
  }

  async stop() {
    logger.info('*** Stopping starter service instance ***');
  }
}

const plugin: Plugin = {
  name: 'starter',
  description: 'A starter plugin for Eliza',
  // Set lowest priority so real models take precedence
  priority: -1000,
  config: {
    EXAMPLE_PLUGIN_VARIABLE: process.env.EXAMPLE_PLUGIN_VARIABLE,
  },
  async init(config: Record<string, string>) {
    logger.info('*** Initializing starter plugin ***');
    try {
      const validatedConfig = await configSchema.parseAsync(config);

      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) process.env[key] = value;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages =
          error.issues?.map((e) => e.message)?.join(', ') || 'Unknown validation error';
        throw new Error(`Invalid plugin configuration: ${errorMessages}`);
      }
      throw new Error(
        `Invalid plugin configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
  routes: [
    {
      name: 'helloworld',
      path: '/helloworld',
      type: 'GET',
      handler: async (_req: any, res: any) => {
        res.json({
          message: 'Hello World!',
        });
      },
    },
    {
      name: 'health',
      path: '/health',
      type: 'GET',
      handler: async (_req: any, res: any) => {
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        });
      },
    },
  ],
  // Template event handlers — debug logging only.
  // Replace with real logic when extending this plugin.
  events: {
    MESSAGE_RECEIVED: [
      async (params) => {
        logger.debug({ keys: Object.keys(params) }, 'MESSAGE_RECEIVED event received');
      },
    ],
    VOICE_MESSAGE_RECEIVED: [
      async (params) => {
        logger.debug({ keys: Object.keys(params) }, 'VOICE_MESSAGE_RECEIVED event received');
      },
    ],
    WORLD_CONNECTED: [
      async (params) => {
        logger.debug({ keys: Object.keys(params) }, 'WORLD_CONNECTED event received');
      },
    ],
    WORLD_JOINED: [
      async (params) => {
        logger.debug({ keys: Object.keys(params) }, 'WORLD_JOINED event received');
      },
    ],
  },
  services: [StarterService],
  actions: [helloWorldAction],
  providers: [helloWorldProvider],
};

export default plugin;
