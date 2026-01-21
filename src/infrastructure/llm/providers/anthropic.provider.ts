import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, CompletionParams, CompletionResponse } from "./base.provider.js";
import {
  LLMProviderError,
  LLMTimeoutError,
  LLMRateLimitError,
  LLMAuthenticationError,
} from "../../../shared/errors/index.js";
import { logger } from "../../../shared/utils/logger.js";

/**
 * Anthropic LLM Provider
 *
 * Implements the LLMProvider interface for Anthropic's Claude models.
 * Features:
 * - Configurable timeout
 * - Proper error handling with typed errors
 * - Token usage tracking
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private timeoutMs: number;

  constructor(apiKey: string, timeoutMs: number = 60000) {
    this.client = new Anthropic({
      apiKey,
      timeout: timeoutMs,
    });
    this.timeoutMs = timeoutMs;
  }

  async complete(params: CompletionParams): Promise<CompletionResponse> {
    const startTime = Date.now();

    try {
      logger.debug(
        {
          provider: this.name,
          model: params.model,
          maxTokens: params.maxTokens,
        },
        "Starting Anthropic completion"
      );

      const response = await this.client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.systemPrompt,
        messages: [{ role: "user", content: params.userPrompt }],
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      });

      const textBlock = response.content.find((block) => block.type === "text");
      const content = textBlock?.type === "text" ? textBlock.text : "";

      const result: CompletionResponse = {
        content,
        model: response.model,
        ...(response.stop_reason ? { stopReason: response.stop_reason } : {}),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };

      logger.debug(
        {
          provider: this.name,
          model: response.model,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          durationMs: Date.now() - startTime,
        },
        "Anthropic completion successful"
      );

      return result;
    } catch (error) {
      return this.handleError(error, params.model, startTime);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Simple ping using a minimal request
      await this.client.messages.create({
        model: "claude-haiku-3-5-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    } catch {
      return false;
    }
  }

  private handleError(error: unknown, model: string, startTime: number): never {
    const durationMs = Date.now() - startTime;

    // Handle Anthropic-specific errors
    if (error instanceof Anthropic.APIError) {
      logger.error(
        {
          provider: this.name,
          model,
          status: error.status,
          message: error.message,
          durationMs,
        },
        "Anthropic API error"
      );

      // Timeout error
      if (error.status === 408 || error.message.includes("timeout")) {
        throw new LLMTimeoutError(this.name, this.timeoutMs);
      }

      // Rate limit error
      if (error.status === 429) {
        const retryAfter = this.extractRetryAfter(error);
        throw new LLMRateLimitError(this.name, retryAfter);
      }

      // Authentication error
      if (error.status === 401) {
        throw new LLMAuthenticationError(this.name);
      }

      // Generic API error
      throw new LLMProviderError(this.name, error.message);
    }

    // Handle timeout from the SDK
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      logger.error(
        { provider: this.name, model, durationMs },
        "Anthropic connection timeout"
      );
      throw new LLMTimeoutError(this.name, this.timeoutMs);
    }

    // Handle generic errors
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: this.name, model, error: message, durationMs },
      "Anthropic unexpected error"
    );
    throw new LLMProviderError(
      this.name,
      message,
      error instanceof Error ? error : undefined
    );
  }

  private extractRetryAfter(error: InstanceType<typeof Anthropic.APIError>): number | undefined {
    // Try to extract retry-after from headers if available
    const headers = error.headers;
    if (headers) {
      const retryAfter = headers["retry-after"];
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) {
          return seconds * 1000; // Convert to milliseconds
        }
      }
    }
    return undefined;
  }
}
