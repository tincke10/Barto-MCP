/**
 * LLM Provider Interface
 *
 * Base interface for all LLM providers (Anthropic, OpenAI, etc.)
 * Provides a unified API for interacting with different LLM services.
 */

/**
 * Parameters for LLM completion requests
 */
export interface CompletionParams {
  /** The model identifier to use */
  model: string;
  /** System prompt that sets the context/behavior */
  systemPrompt: string;
  /** User prompt with the actual request */
  userPrompt: string;
  /** Maximum tokens in the response */
  maxTokens: number;
  /** Optional temperature for response variability (0-1) */
  temperature?: number;
}

/**
 * Response from LLM completion
 */
export interface CompletionResponse {
  /** The generated text content */
  content: string;
  /** Token usage statistics */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Model used for completion */
  model: string;
  /** Stop reason if available */
  stopReason?: string;
}

/**
 * LLM Provider interface
 *
 * All LLM providers must implement this interface to ensure
 * consistent behavior across different services.
 */
export interface LLMProvider {
  /** Provider name identifier */
  readonly name: string;

  /**
   * Send a completion request to the LLM
   *
   * @param params - Completion parameters
   * @returns Promise resolving to the completion response
   * @throws LLMProviderError on API errors
   * @throws LLMTimeoutError on timeout
   * @throws LLMRateLimitError on rate limit exceeded
   */
  complete(params: CompletionParams): Promise<CompletionResponse>;

  /**
   * Check if the provider is healthy/available
   *
   * @returns Promise resolving to true if healthy
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Type for supported LLM providers
 */
export type LLMProviderType = "anthropic" | "openai";
