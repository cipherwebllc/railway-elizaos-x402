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

// node_modules/jsonrepair/lib/esm/utils/JSONRepairError.js
class JSONRepairError extends Error {
  constructor(message, position) {
    super(`${message} at position ${position}`);
    this.position = position;
  }
}

// node_modules/jsonrepair/lib/esm/utils/stringUtils.js
var codeSpace = 32;
var codeNewline = 10;
var codeTab = 9;
var codeReturn = 13;
var codeNonBreakingSpace = 160;
var codeEnQuad = 8192;
var codeHairSpace = 8202;
var codeNarrowNoBreakSpace = 8239;
var codeMediumMathematicalSpace = 8287;
var codeIdeographicSpace = 12288;
function isHex(char) {
  return /^[0-9A-Fa-f]$/.test(char);
}
function isDigit(char) {
  return char >= "0" && char <= "9";
}
function isValidStringCharacter(char) {
  return char >= " ";
}
function isDelimiter(char) {
  return `,:[]/{}()
+`.includes(char);
}
function isFunctionNameCharStart(char) {
  return char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char === "_" || char === "$";
}
function isFunctionNameChar(char) {
  return char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char === "_" || char === "$" || char >= "0" && char <= "9";
}
var regexUrlStart = /^(http|https|ftp|mailto|file|data|irc):\/\/$/;
var regexUrlChar = /^[A-Za-z0-9-._~:/?#@!$&'()*+;=]$/;
function isUnquotedStringDelimiter(char) {
  return `,[]/{}
+`.includes(char);
}
function isStartOfValue(char) {
  return isQuote(char) || regexStartOfValue.test(char);
}
var regexStartOfValue = /^[[{\w-]$/;
function isControlCharacter(char) {
  return char === `
` || char === "\r" || char === "\t" || char === "\b" || char === "\f";
}
function isWhitespace(text, index) {
  const code = text.charCodeAt(index);
  return code === codeSpace || code === codeNewline || code === codeTab || code === codeReturn;
}
function isWhitespaceExceptNewline(text, index) {
  const code = text.charCodeAt(index);
  return code === codeSpace || code === codeTab || code === codeReturn;
}
function isSpecialWhitespace(text, index) {
  const code = text.charCodeAt(index);
  return code === codeNonBreakingSpace || code >= codeEnQuad && code <= codeHairSpace || code === codeNarrowNoBreakSpace || code === codeMediumMathematicalSpace || code === codeIdeographicSpace;
}
function isQuote(char) {
  return isDoubleQuoteLike(char) || isSingleQuoteLike(char);
}
function isDoubleQuoteLike(char) {
  return char === '"' || char === "“" || char === "”";
}
function isDoubleQuote(char) {
  return char === '"';
}
function isSingleQuoteLike(char) {
  return char === "'" || char === "‘" || char === "’" || char === "`" || char === "´";
}
function isSingleQuote(char) {
  return char === "'";
}
function stripLastOccurrence(text, textToStrip) {
  let stripRemainingText = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
  const index = text.lastIndexOf(textToStrip);
  return index !== -1 ? text.substring(0, index) + (stripRemainingText ? "" : text.substring(index + 1)) : text;
}
function insertBeforeLastWhitespace(text, textToInsert) {
  let index = text.length;
  if (!isWhitespace(text, index - 1)) {
    return text + textToInsert;
  }
  while (isWhitespace(text, index - 1)) {
    index--;
  }
  return text.substring(0, index) + textToInsert + text.substring(index);
}
function removeAtIndex(text, start, count) {
  return text.substring(0, start) + text.substring(start + count);
}
function endsWithCommaOrNewline(text) {
  return /[,\n][ \t\r]*$/.test(text);
}

// node_modules/jsonrepair/lib/esm/regular/jsonrepair.js
var controlCharacters = {
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t"
};
var escapeCharacters = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: `
`,
  r: "\r",
  t: "\t"
};
function jsonrepair(text) {
  let i = 0;
  let output = "";
  parseMarkdownCodeBlock(["```", "[```", "{```"]);
  const processed = parseValue();
  if (!processed) {
    throwUnexpectedEnd();
  }
  parseMarkdownCodeBlock(["```", "```]", "```}"]);
  const processedComma = parseCharacter(",");
  if (processedComma) {
    parseWhitespaceAndSkipComments();
  }
  if (isStartOfValue(text[i]) && endsWithCommaOrNewline(output)) {
    if (!processedComma) {
      output = insertBeforeLastWhitespace(output, ",");
    }
    parseNewlineDelimitedJSON();
  } else if (processedComma) {
    output = stripLastOccurrence(output, ",");
  }
  while (text[i] === "}" || text[i] === "]") {
    i++;
    parseWhitespaceAndSkipComments();
  }
  if (i >= text.length) {
    return output;
  }
  throwUnexpectedCharacter();
  function parseValue() {
    parseWhitespaceAndSkipComments();
    const processed2 = parseObject() || parseArray() || parseString() || parseNumber() || parseKeywords() || parseUnquotedString(false) || parseRegex();
    parseWhitespaceAndSkipComments();
    return processed2;
  }
  function parseWhitespaceAndSkipComments() {
    let skipNewline = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;
    const start = i;
    let changed = parseWhitespace(skipNewline);
    do {
      changed = parseComment();
      if (changed) {
        changed = parseWhitespace(skipNewline);
      }
    } while (changed);
    return i > start;
  }
  function parseWhitespace(skipNewline) {
    const _isWhiteSpace = skipNewline ? isWhitespace : isWhitespaceExceptNewline;
    let whitespace = "";
    while (true) {
      if (_isWhiteSpace(text, i)) {
        whitespace += text[i];
        i++;
      } else if (isSpecialWhitespace(text, i)) {
        whitespace += " ";
        i++;
      } else {
        break;
      }
    }
    if (whitespace.length > 0) {
      output += whitespace;
      return true;
    }
    return false;
  }
  function parseComment() {
    if (text[i] === "/" && text[i + 1] === "*") {
      while (i < text.length && !atEndOfBlockComment(text, i)) {
        i++;
      }
      i += 2;
      return true;
    }
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== `
`) {
        i++;
      }
      return true;
    }
    return false;
  }
  function parseMarkdownCodeBlock(blocks) {
    if (skipMarkdownCodeBlock(blocks)) {
      if (isFunctionNameCharStart(text[i])) {
        while (i < text.length && isFunctionNameChar(text[i])) {
          i++;
        }
      }
      parseWhitespaceAndSkipComments();
      return true;
    }
    return false;
  }
  function skipMarkdownCodeBlock(blocks) {
    parseWhitespace(true);
    for (const block of blocks) {
      const end = i + block.length;
      if (text.slice(i, end) === block) {
        i = end;
        return true;
      }
    }
    return false;
  }
  function parseCharacter(char) {
    if (text[i] === char) {
      output += text[i];
      i++;
      return true;
    }
    return false;
  }
  function skipCharacter(char) {
    if (text[i] === char) {
      i++;
      return true;
    }
    return false;
  }
  function skipEscapeCharacter() {
    return skipCharacter("\\");
  }
  function skipEllipsis() {
    parseWhitespaceAndSkipComments();
    if (text[i] === "." && text[i + 1] === "." && text[i + 2] === ".") {
      i += 3;
      parseWhitespaceAndSkipComments();
      skipCharacter(",");
      return true;
    }
    return false;
  }
  function parseObject() {
    if (text[i] === "{") {
      output += "{";
      i++;
      parseWhitespaceAndSkipComments();
      if (skipCharacter(",")) {
        parseWhitespaceAndSkipComments();
      }
      let initial = true;
      while (i < text.length && text[i] !== "}") {
        let processedComma2;
        if (!initial) {
          processedComma2 = parseCharacter(",");
          if (!processedComma2) {
            output = insertBeforeLastWhitespace(output, ",");
          }
          parseWhitespaceAndSkipComments();
        } else {
          processedComma2 = true;
          initial = false;
        }
        skipEllipsis();
        const processedKey = parseString() || parseUnquotedString(true);
        if (!processedKey) {
          if (text[i] === "}" || text[i] === "{" || text[i] === "]" || text[i] === "[" || text[i] === undefined) {
            output = stripLastOccurrence(output, ",");
          } else {
            throwObjectKeyExpected();
          }
          break;
        }
        parseWhitespaceAndSkipComments();
        const processedColon = parseCharacter(":");
        const truncatedText = i >= text.length;
        if (!processedColon) {
          if (isStartOfValue(text[i]) || truncatedText) {
            output = insertBeforeLastWhitespace(output, ":");
          } else {
            throwColonExpected();
          }
        }
        const processedValue = parseValue();
        if (!processedValue) {
          if (processedColon || truncatedText) {
            output += "null";
          } else {
            throwColonExpected();
          }
        }
      }
      if (text[i] === "}") {
        output += "}";
        i++;
      } else {
        output = insertBeforeLastWhitespace(output, "}");
      }
      return true;
    }
    return false;
  }
  function parseArray() {
    if (text[i] === "[") {
      output += "[";
      i++;
      parseWhitespaceAndSkipComments();
      if (skipCharacter(",")) {
        parseWhitespaceAndSkipComments();
      }
      let initial = true;
      while (i < text.length && text[i] !== "]") {
        if (!initial) {
          const processedComma2 = parseCharacter(",");
          if (!processedComma2) {
            output = insertBeforeLastWhitespace(output, ",");
          }
        } else {
          initial = false;
        }
        skipEllipsis();
        const processedValue = parseValue();
        if (!processedValue) {
          output = stripLastOccurrence(output, ",");
          break;
        }
      }
      if (text[i] === "]") {
        output += "]";
        i++;
      } else {
        output = insertBeforeLastWhitespace(output, "]");
      }
      return true;
    }
    return false;
  }
  function parseNewlineDelimitedJSON() {
    let initial = true;
    let processedValue = true;
    while (processedValue) {
      if (!initial) {
        const processedComma2 = parseCharacter(",");
        if (!processedComma2) {
          output = insertBeforeLastWhitespace(output, ",");
        }
      } else {
        initial = false;
      }
      processedValue = parseValue();
    }
    if (!processedValue) {
      output = stripLastOccurrence(output, ",");
    }
    output = `[
${output}
]`;
  }
  function parseString() {
    let stopAtDelimiter = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
    let stopAtIndex = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : -1;
    let skipEscapeChars = text[i] === "\\";
    if (skipEscapeChars) {
      i++;
      skipEscapeChars = true;
    }
    if (isQuote(text[i])) {
      const isEndQuote = isDoubleQuote(text[i]) ? isDoubleQuote : isSingleQuote(text[i]) ? isSingleQuote : isSingleQuoteLike(text[i]) ? isSingleQuoteLike : isDoubleQuoteLike;
      const iBefore = i;
      const oBefore = output.length;
      let str = '"';
      i++;
      while (true) {
        if (i >= text.length) {
          const iPrev = prevNonWhitespaceIndex(i - 1);
          if (!stopAtDelimiter && isDelimiter(text.charAt(iPrev))) {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(true);
          }
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          return true;
        }
        if (i === stopAtIndex) {
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          return true;
        }
        if (isEndQuote(text[i])) {
          const iQuote = i;
          const oQuote = str.length;
          str += '"';
          i++;
          output += str;
          parseWhitespaceAndSkipComments(false);
          if (stopAtDelimiter || i >= text.length || isDelimiter(text[i]) || isQuote(text[i]) || isDigit(text[i])) {
            parseConcatenatedString();
            return true;
          }
          const iPrevChar = prevNonWhitespaceIndex(iQuote - 1);
          const prevChar = text.charAt(iPrevChar);
          if (prevChar === ",") {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(false, iPrevChar);
          }
          if (isDelimiter(prevChar)) {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(true);
          }
          output = output.substring(0, oBefore);
          i = iQuote + 1;
          str = `${str.substring(0, oQuote)}\\${str.substring(oQuote)}`;
        } else if (stopAtDelimiter && isUnquotedStringDelimiter(text[i])) {
          if (text[i - 1] === ":" && regexUrlStart.test(text.substring(iBefore + 1, i + 2))) {
            while (i < text.length && regexUrlChar.test(text[i])) {
              str += text[i];
              i++;
            }
          }
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          parseConcatenatedString();
          return true;
        } else if (text[i] === "\\") {
          const char = text.charAt(i + 1);
          const escapeChar = escapeCharacters[char];
          if (escapeChar !== undefined) {
            str += text.slice(i, i + 2);
            i += 2;
          } else if (char === "u") {
            let j = 2;
            while (j < 6 && isHex(text[i + j])) {
              j++;
            }
            if (j === 6) {
              str += text.slice(i, i + 6);
              i += 6;
            } else if (i + j >= text.length) {
              i = text.length;
            } else {
              throwInvalidUnicodeCharacter();
            }
          } else {
            str += char;
            i += 2;
          }
        } else {
          const char = text.charAt(i);
          if (char === '"' && text[i - 1] !== "\\") {
            str += `\\${char}`;
            i++;
          } else if (isControlCharacter(char)) {
            str += controlCharacters[char];
            i++;
          } else {
            if (!isValidStringCharacter(char)) {
              throwInvalidCharacter(char);
            }
            str += char;
            i++;
          }
        }
        if (skipEscapeChars) {
          skipEscapeCharacter();
        }
      }
    }
    return false;
  }
  function parseConcatenatedString() {
    let processed2 = false;
    parseWhitespaceAndSkipComments();
    while (text[i] === "+") {
      processed2 = true;
      i++;
      parseWhitespaceAndSkipComments();
      output = stripLastOccurrence(output, '"', true);
      const start = output.length;
      const parsedStr = parseString();
      if (parsedStr) {
        output = removeAtIndex(output, start, 1);
      } else {
        output = insertBeforeLastWhitespace(output, '"');
      }
    }
    return processed2;
  }
  function parseNumber() {
    const start = i;
    if (text[i] === "-") {
      i++;
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
    }
    while (isDigit(text[i])) {
      i++;
    }
    if (text[i] === ".") {
      i++;
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
      while (isDigit(text[i])) {
        i++;
      }
    }
    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "-" || text[i] === "+") {
        i++;
      }
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
      while (isDigit(text[i])) {
        i++;
      }
    }
    if (!atEndOfNumber()) {
      i = start;
      return false;
    }
    if (i > start) {
      const num = text.slice(start, i);
      const hasInvalidLeadingZero = /^0\d/.test(num);
      output += hasInvalidLeadingZero ? `"${num}"` : num;
      return true;
    }
    return false;
  }
  function parseKeywords() {
    return parseKeyword("true", "true") || parseKeyword("false", "false") || parseKeyword("null", "null") || parseKeyword("True", "true") || parseKeyword("False", "false") || parseKeyword("None", "null");
  }
  function parseKeyword(name, value) {
    if (text.slice(i, i + name.length) === name) {
      output += value;
      i += name.length;
      return true;
    }
    return false;
  }
  function parseUnquotedString(isKey) {
    const start = i;
    if (isFunctionNameCharStart(text[i])) {
      while (i < text.length && isFunctionNameChar(text[i])) {
        i++;
      }
      let j = i;
      while (isWhitespace(text, j)) {
        j++;
      }
      if (text[j] === "(") {
        i = j + 1;
        parseValue();
        if (text[i] === ")") {
          i++;
          if (text[i] === ";") {
            i++;
          }
        }
        return true;
      }
    }
    while (i < text.length && !isUnquotedStringDelimiter(text[i]) && !isQuote(text[i]) && (!isKey || text[i] !== ":")) {
      i++;
    }
    if (text[i - 1] === ":" && regexUrlStart.test(text.substring(start, i + 2))) {
      while (i < text.length && regexUrlChar.test(text[i])) {
        i++;
      }
    }
    if (i > start) {
      while (isWhitespace(text, i - 1) && i > 0) {
        i--;
      }
      const symbol = text.slice(start, i);
      output += symbol === "undefined" ? "null" : JSON.stringify(symbol);
      if (text[i] === '"') {
        i++;
      }
      return true;
    }
  }
  function parseRegex() {
    if (text[i] === "/") {
      const start = i;
      i++;
      while (i < text.length && (text[i] !== "/" || text[i - 1] === "\\")) {
        i++;
      }
      i++;
      output += `"${text.substring(start, i)}"`;
      return true;
    }
  }
  function prevNonWhitespaceIndex(start) {
    let prev = start;
    while (prev > 0 && isWhitespace(text, prev)) {
      prev--;
    }
    return prev;
  }
  function atEndOfNumber() {
    return i >= text.length || isDelimiter(text[i]) || isWhitespace(text, i);
  }
  function repairNumberEndingWithNumericSymbol(start) {
    output += `${text.slice(start, i)}0`;
  }
  function throwInvalidCharacter(char) {
    throw new JSONRepairError(`Invalid character ${JSON.stringify(char)}`, i);
  }
  function throwUnexpectedCharacter() {
    throw new JSONRepairError(`Unexpected character ${JSON.stringify(text[i])}`, i);
  }
  function throwUnexpectedEnd() {
    throw new JSONRepairError("Unexpected end of json string", text.length);
  }
  function throwObjectKeyExpected() {
    throw new JSONRepairError("Object key expected", i);
  }
  function throwColonExpected() {
    throw new JSONRepairError("Colon expected", i);
  }
  function throwInvalidUnicodeCharacter() {
    const chars = text.slice(i, i + 6);
    throw new JSONRepairError(`Invalid unicode character "${chars}"`, i);
  }
}
function atEndOfBlockComment(text, i) {
  return text[i] === "*" && text[i + 1] === "/";
}
// src/utils/json.ts
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

//# debugId=422A305E8D5804A164756E2164756E21
