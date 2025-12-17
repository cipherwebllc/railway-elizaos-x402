// src/index.ts
import { ModelType as ModelType3 } from "@elizaos/core";

// src/init.ts
import { logger as logger2 } from "@elizaos/core";

// src/utils/config.ts
import { logger } from "@elizaos/core";
function getSetting(runtime, key, defaultValue) {
  return runtime.getSetting(key) ?? process.env[key] ?? defaultValue;
}
function isBrowser() {
  return typeof globalThis !== "undefined" && typeof globalThis.document !== "undefined";
}
function getBaseURL(runtime) {
  const browserURL = getSetting(runtime, "ANTHROPIC_BROWSER_BASE_URL");
  const baseURL = isBrowser() && browserURL ? browserURL : getSetting(runtime, "ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1");
  logger.debug(`[Anthropic] Base URL: ${baseURL}`);
  return baseURL;
}
function getApiKey(runtime) {
  return getSetting(runtime, "ANTHROPIC_API_KEY");
}
function getSmallModel(runtime) {
  return getSetting(runtime, "ANTHROPIC_SMALL_MODEL", "claude-3-5-haiku-20241022");
}
function getLargeModel(runtime) {
  return getSetting(runtime, "ANTHROPIC_LARGE_MODEL", "claude-sonnet-4-20250514");
}
function getExperimentalTelemetry(runtime) {
  const setting = getSetting(runtime, "ANTHROPIC_EXPERIMENTAL_TELEMETRY", "false");
  const normalizedSetting = String(setting).toLowerCase();
  const result = normalizedSetting === "true";
  logger.debug(`[Anthropic] Experimental telemetry: "${setting}" (normalized: "${normalizedSetting}", result: ${result})`);
  return result;
}

// src/init.ts
function initializeAnthropic(_config, runtime) {
  new Promise(async (resolve) => {
    resolve();
    try {
      const apiKey = getApiKey(runtime);
      if (!apiKey && !isBrowser()) {
        logger2.warn("ANTHROPIC_API_KEY is not set in environment - Anthropic functionality will be limited");
        return;
      }
      if (apiKey) {
        logger2.log("Anthropic API key configured successfully");
      }
    } catch (error) {
      const message = error?.errors?.map((e) => e.message).join(", ") || (error instanceof Error ? error.message : String(error));
      logger2.warn(`Anthropic plugin configuration issue: ${message} - You need to configure the ANTHROPIC_API_KEY in your environment variables`);
    }
  });
}

// src/models/text.ts
import { logger as logger3, ModelType } from "@elizaos/core";
import { generateText } from "ai";

// src/providers/anthropic.ts
import { createAnthropic } from "@ai-sdk/anthropic";
function createAnthropicClient(runtime) {
  return createAnthropic({
    apiKey: isBrowser() ? undefined : getApiKey(runtime),
    baseURL: getBaseURL(runtime)
  });
}
// src/utils/events.ts
import { EventType } from "@elizaos/core";
function emitModelUsageEvent(runtime, type, prompt, usage) {
  runtime.emitEvent(EventType.MODEL_USED, {
    provider: "anthropic",
    type,
    prompt,
    tokens: {
      prompt: usage.inputTokens,
      completion: usage.outputTokens,
      total: usage.totalTokens
    }
  });
}

// src/models/text.ts
async function handleTextSmall(runtime, {
  prompt,
  stopSequences = [],
  maxTokens,
  temperature = 0.7,
  frequencyPenalty = 0.7,
  presencePenalty = 0.7
}) {
  const anthropic2 = createAnthropicClient(runtime);
  const modelName = getSmallModel(runtime);
  const experimentalTelemetry = getExperimentalTelemetry(runtime);
  if (maxTokens === undefined) {
    maxTokens = modelName.includes("-3-") ? 4096 : 8192;
  }
  logger3.log(`[Anthropic] Using TEXT_SMALL model: ${modelName}`);
  const { text, usage } = await generateText({
    model: anthropic2(modelName),
    prompt,
    system: runtime.character.system ?? undefined,
    temperature,
    maxOutputTokens: maxTokens,
    stopSequences,
    frequencyPenalty,
    presencePenalty,
    experimental_telemetry: { isEnabled: experimentalTelemetry }
  });
  if (usage) {
    emitModelUsageEvent(runtime, ModelType.TEXT_SMALL, prompt, usage);
  }
  return text;
}
async function handleTextLarge(runtime, {
  prompt,
  maxTokens = 8192,
  stopSequences = [],
  temperature = 0.7,
  frequencyPenalty = 0.7,
  presencePenalty = 0.7
}) {
  const anthropic2 = createAnthropicClient(runtime);
  const modelName = getLargeModel(runtime);
  const experimentalTelemetry = getExperimentalTelemetry(runtime);
  logger3.log(`[Anthropic] Using TEXT_LARGE model: ${modelName}`);
  const { text, usage } = await generateText({
    model: anthropic2(modelName),
    prompt,
    system: runtime.character.system ?? undefined,
    temperature,
    maxOutputTokens: maxTokens,
    stopSequences,
    frequencyPenalty,
    presencePenalty,
    experimental_telemetry: { isEnabled: experimentalTelemetry }
  });
  if (usage) {
    emitModelUsageEvent(runtime, ModelType.TEXT_LARGE, prompt, usage);
  }
  return text;
}
// src/models/object.ts
import { logger as logger5, ModelType as ModelType2 } from "@elizaos/core";
import { generateText as generateText2 } from "ai";

// src/utils/json.ts
import { logger as logger4 } from "@elizaos/core";
import { jsonrepair } from "jsonrepair";
var ensureReflectionProperties = (obj, isReflection) => {
  if (!isReflection)
    return obj;
  if (obj !== null && typeof obj === "object") {
    return {
      ...obj,
      thought: "thought" in obj ? obj.thought || "" : "",
      facts: "facts" in obj ? obj.facts || [] : [],
      relationships: "relationships" in obj ? obj.relationships || [] : []
    };
  }
  return obj;
};
var extractAndParseJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (initialError) {
    logger4.debug("Initial JSON parse failed, attempting alternative extraction methods");
    try {
      const repaired = jsonrepair(text);
      return JSON.parse(repaired);
    } catch (repairError) {
      logger4.debug("JSONRepair failed, proceeding with manual extraction methods");
    }
    const isJsonWithCodeBlocks = text.trim().startsWith("{") && text.trim().endsWith("}") && text.includes("```");
    if (isJsonWithCodeBlocks) {
      try {
        const codeBlockPlaceholders = [];
        let placeholderCounter = 0;
        const textWithPlaceholders = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, language, code) => {
          const placeholder = `__CODE_BLOCK_${placeholderCounter++}__`;
          codeBlockPlaceholders.push({
            placeholder,
            content: `\`\`\`${language}
${code}\`\`\``
          });
          return placeholder;
        });
        let parsed;
        try {
          const repaired = jsonrepair(textWithPlaceholders);
          parsed = JSON.parse(repaired);
        } catch (e) {
          parsed = JSON.parse(textWithPlaceholders);
        }
        const restoreCodeBlocks = (obj) => {
          if (typeof obj === "string") {
            let result = obj;
            for (const { placeholder, content } of codeBlockPlaceholders) {
              result = result.replace(placeholder, content);
            }
            return result;
          } else if (Array.isArray(obj)) {
            return obj.map((item) => restoreCodeBlocks(item));
          } else if (obj !== null && typeof obj === "object") {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
              result[key] = restoreCodeBlocks(value);
            }
            return result;
          }
          return obj;
        };
        return restoreCodeBlocks(parsed);
      } catch (codeBlockError) {
        logger4.debug("Code block preservation failed, continuing with other methods");
      }
    }
    const extractFromCodeBlocks = (text2) => {
      const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
      const jsonMatch = text2.match(jsonBlockRegex);
      if (jsonMatch && jsonMatch[1]) {
        return jsonMatch[1].trim();
      }
      const anyBlockRegex = /```(?:\w*)\s*([\s\S]*?)\s*```/g;
      let match;
      while ((match = anyBlockRegex.exec(text2)) !== null) {
        const blockContent = match[1].trim();
        if (blockContent.startsWith("{") && blockContent.endsWith("}")) {
          return blockContent;
        }
      }
      return null;
    };
    const extractedFromCodeBlock = extractFromCodeBlocks(text);
    if (extractedFromCodeBlock) {
      try {
        return JSON.parse(extractedFromCodeBlock);
      } catch (blockParseError) {
        try {
          const repaired = jsonrepair(extractedFromCodeBlock);
          return JSON.parse(repaired);
        } catch (blockRepairError) {
          logger4.debug("Failed to parse JSON from code block after repair");
        }
      }
    }
    const extractJSON = (text2) => {
      const jsonContentRegex = /(^|\n)\s*(\{[\s\S]*\})\s*($|\n)/;
      const contentMatch = text2.match(jsonContentRegex);
      if (contentMatch && contentMatch[2]) {
        return contentMatch[2].trim();
      }
      const jsonPattern = /\{[\s\S]*?\}/g;
      const jsonMatches = text2.match(jsonPattern);
      if (jsonMatches && jsonMatches.length > 0) {
        return [...jsonMatches].sort((a, b) => b.length - a.length)[0];
      }
      return null;
    };
    const extractedJSON = extractJSON(text);
    if (extractedJSON) {
      try {
        return JSON.parse(extractedJSON);
      } catch (extractParseError) {
        try {
          const repaired = jsonrepair(extractedJSON);
          return JSON.parse(repaired);
        } catch (extractRepairError) {
          logger4.debug("Failed to parse JSON after extraction and repair");
        }
      }
    }
    const manuallyExtractStructure = (text2) => {
      const thoughtPattern = /"thought"\s*:\s*"([^"]*?)(?:"|$)/;
      const messagePattern = /"message"\s*:\s*"([^"]*?)(?:"|$)/;
      const thoughtMatch = text2.match(thoughtPattern);
      const messageMatch = text2.match(messagePattern);
      if (thoughtMatch || messageMatch) {
        const extractedContent = {
          type: "reconstructed_response"
        };
        if (thoughtMatch) {
          extractedContent.thought = thoughtMatch[1].replace(/\\n/g, `
`);
        }
        if (messageMatch) {
          extractedContent.message = messageMatch[1].replace(/\\n/g, `
`);
        } else {
          let remainingContent = text2;
          if (thoughtMatch) {
            remainingContent = remainingContent.replace(thoughtPattern, "");
          }
          const codeBlocks = [];
          const codeBlockRegex = /```([\w]*)\n([\s\S]*?)```/g;
          let match;
          while ((match = codeBlockRegex.exec(remainingContent)) !== null) {
            codeBlocks.push({
              language: match[1] || "text",
              code: match[2].trim()
            });
          }
          if (codeBlocks.length > 0) {
            extractedContent.codeBlocks = codeBlocks;
            remainingContent = remainingContent.replace(codeBlockRegex, "");
          }
          extractedContent.message = remainingContent.trim();
        }
        return extractedContent;
      }
      if (text2.includes("thought") || text2.includes("facts") || text2.includes("relationships")) {
        logger4.debug("Attempting to extract reflection schema components");
        const result = {
          thought: "",
          facts: [],
          relationships: [],
          rawContent: text2
        };
        const thoughtMatch2 = text2.match(/thought["\s:]+([^"{}[\],]+)/i);
        if (thoughtMatch2) {
          result.thought = thoughtMatch2[1].trim();
        }
        return result;
      }
      return null;
    };
    const manuallyExtracted = manuallyExtractStructure(text);
    if (manuallyExtracted) {
      return manuallyExtracted;
    }
    logger4.debug("All JSON extraction methods failed, returning structured object with raw content");
    return {
      type: "unstructured_response",
      content: text
    };
  }
};

// src/models/object.ts
async function generateObjectByModelType(runtime, params, modelType, getModelFn) {
  const anthropic2 = createAnthropicClient(runtime);
  const modelName = getModelFn(runtime);
  logger5.log(`[Anthropic] Using ${modelType} model: ${modelName}`);
  try {
    const isReflection = !!(params.schema?.facts && params.schema.relationships);
    let jsonPrompt = params.prompt;
    if (!jsonPrompt.includes("```json") && !jsonPrompt.includes("respond with valid JSON")) {
      jsonPrompt += `
Please respond with valid JSON only, without any explanations, markdown formatting, or additional text.`;
    }
    let systemPrompt = runtime.character.system ? `${runtime.character.system}
You must respond with valid JSON only.` : "You must respond with valid JSON only.";
    if (isReflection) {
      systemPrompt += " Ensure your response includes 'thought', 'facts', and 'relationships' properties exactly as specified in the prompt.";
    } else {
      systemPrompt += " No markdown, no code blocks, no explanation text.";
    }
    const { text, usage } = await generateText2({
      model: anthropic2(modelName),
      prompt: jsonPrompt,
      system: systemPrompt,
      temperature: params.temperature || 0.2
    });
    if (usage) {
      emitModelUsageEvent(runtime, modelType, params.prompt, usage);
    }
    try {
      logger5.debug("Attempting to parse response from Anthropic model");
      const jsonObject = extractAndParseJSON(text);
      const processedObject = ensureReflectionProperties(jsonObject, isReflection);
      return processedObject;
    } catch (parseError) {
      logger5.error(`Failed to parse JSON from Anthropic response: ${parseError}`);
      logger5.error(`Raw response: ${text}`);
      throw new Error("Invalid JSON returned from Anthropic model");
    }
  } catch (error) {
    logger5.error(`Error generating object: ${error}`);
    throw error;
  }
}
async function handleObjectSmall(runtime, params) {
  return generateObjectByModelType(runtime, params, ModelType2.OBJECT_SMALL, getSmallModel);
}
async function handleObjectLarge(runtime, params) {
  return generateObjectByModelType(runtime, params, ModelType2.OBJECT_LARGE, getLargeModel);
}
// src/index.ts
import { logger as logger6 } from "@elizaos/core";
var anthropicPlugin = {
  name: "anthropic",
  description: "Anthropic plugin (supports text generation only)",
  config: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_SMALL_MODEL: process.env.ANTHROPIC_SMALL_MODEL,
    ANTHROPIC_LARGE_MODEL: process.env.ANTHROPIC_LARGE_MODEL,
    ANTHROPIC_EXPERIMENTAL_TELEMETRY: process.env.ANTHROPIC_EXPERIMENTAL_TELEMETRY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_BROWSER_BASE_URL: process.env.ANTHROPIC_BROWSER_BASE_URL
  },
  async init(_config, runtime) {
    initializeAnthropic(_config, runtime);
  },
  models: {
    [ModelType3.TEXT_SMALL]: async (runtime, params) => {
      return handleTextSmall(runtime, params);
    },
    [ModelType3.TEXT_LARGE]: async (runtime, params) => {
      return handleTextLarge(runtime, params);
    },
    [ModelType3.OBJECT_SMALL]: async (runtime, params) => {
      return handleObjectSmall(runtime, params);
    },
    [ModelType3.OBJECT_LARGE]: async (runtime, params) => {
      return handleObjectLarge(runtime, params);
    }
  },
  tests: [
    {
      name: "anthropic_plugin_tests",
      tests: [
        {
          name: "anthropic_test_api_key_validation",
          fn: async (runtime) => {
            const apiKey = getApiKey(runtime);
            if (!apiKey) {
              throw new Error("ANTHROPIC_API_KEY is not configured");
            }
            logger6.log("Anthropic API key is configured");
          }
        },
        {
          name: "anthropic_test_text_small",
          fn: async (runtime) => {
            try {
              const text = await runtime.useModel(ModelType3.TEXT_SMALL, {
                prompt: "What is the nature of reality in 10 words?"
              });
              if (text.length === 0) {
                throw new Error("Failed to generate text");
              }
              logger6.log({ text }, "generated with test_text_small");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger6.error(`Error in test_text_small: ${message}`);
              throw error;
            }
          }
        },
        {
          name: "anthropic_test_text_large",
          fn: async (runtime) => {
            try {
              const text = await runtime.useModel(ModelType3.TEXT_LARGE, {
                prompt: "What is the nature of reality in 10 words?"
              });
              if (text.length === 0) {
                throw new Error("Failed to generate text");
              }
              logger6.log({ text }, "generated with test_text_large");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger6.error(`Error in test_text_large: ${message}`);
              throw error;
            }
          }
        },
        {
          name: "anthropic_test_object_small",
          fn: async (runtime) => {
            try {
              const result = await runtime.useModel(ModelType3.OBJECT_SMALL, {
                prompt: "Create a simple JSON object with a message field saying hello",
                schema: { type: "object" }
              });
              logger6.log({ result }, "Generated object with test_object_small");
              if (!result || typeof result === "object" && "error" in result) {
                throw new Error("Failed to generate object");
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger6.error(`Error in test_object_small: ${message}`);
              throw error;
            }
          }
        },
        {
          name: "anthropic_test_object_large",
          fn: async (runtime) => {
            try {
              const result = await runtime.useModel(ModelType3.OBJECT_LARGE, {
                prompt: "Create a simple JSON object with a message field saying hello",
                schema: { type: "object" }
              });
              logger6.log({ result }, "Generated object with test_object_large");
              if (!result || typeof result === "object" && "error" in result) {
                throw new Error("Failed to generate object");
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger6.error(`Error in test_object_large: ${message}`);
              throw error;
            }
          }
        },
        {
          name: "anthropic_test_object_with_code_blocks",
          fn: async (runtime) => {
            try {
              const result = await runtime.useModel(ModelType3.OBJECT_SMALL, {
                prompt: "Give me instructions to install Node.js",
                schema: { type: "object" }
              });
              logger6.log({ result }, "Generated object with code blocks");
              if (!result || typeof result === "object" && "error" in result) {
                throw new Error("Failed to generate object with code blocks");
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger6.error(`Error in test_object_with_code_blocks: ${message}`);
              throw error;
            }
          }
        }
      ]
    }
  ]
};
var src_default = anthropicPlugin;
export {
  src_default as default,
  anthropicPlugin
};

//# debugId=0F9EBD3A31E0E6E164756E2164756E21
