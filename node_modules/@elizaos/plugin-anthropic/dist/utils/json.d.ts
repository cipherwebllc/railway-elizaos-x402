/**
 * Type for reconstructed response
 */
export interface ReconstructedResponse {
    type: 'reconstructed_response';
    thought?: string;
    message?: string;
    codeBlocks?: Array<{
        language: string;
        code: string;
    }>;
}
/**
 * Type for reflection schema response
 */
export interface ReflectionResponse {
    thought: string;
    facts: unknown[];
    relationships: unknown[];
    rawContent: string;
}
/**
 * Type for unstructured response
 */
export interface UnstructuredResponse {
    type: 'unstructured_response';
    content: string;
}
/**
 * Type for JSON extraction result
 */
export type ExtractedJSON = Record<string, unknown> | ReconstructedResponse | ReflectionResponse | UnstructuredResponse;
/**
 * Helper function to ensure reflection response has all required properties
 */
export declare const ensureReflectionProperties: (obj: ExtractedJSON, isReflection: boolean) => ExtractedJSON;
/**
 * Enhanced function to extract and parse JSON from LLM responses
 * Handles various response formats including mixed markdown and JSON with code blocks
 */
export declare const extractAndParseJSON: (text: string) => ExtractedJSON;
