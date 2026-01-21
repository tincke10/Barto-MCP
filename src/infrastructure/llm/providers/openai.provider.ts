import OpenAI from "openai";
import type { LLMProvider, CompletionParams, CompletionResponse } from "./base.provider.js";
import {
  LLMProviderError,
  LLMTimeoutError,
  LLMRateLimitError,
  LLMAuthenticationError,
} from "../../../shared/errors/index.js";
import { logger } from "../../../shared/utils/logger.js";

/**
 * OpenAI LLM Provider
 *
 * Implements the LLMProvider interface for OpenAI's GPT models.
 * Features:
 * - Configurable timeout
 * - Proper error handling with typed errors
 * - Token usage tracking
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;
  private timeoutMs: number;

  constructor(apiKey: string, timeoutMs: number = 60000) {
    this.client = new OpenAI({
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
        "Starting OpenAI completion"
      );

      const response = await this.client.chat.completions.create({
        model: params.model,
        max_tokens: params.maxTokens,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
        ],
      });

      const choice = response.choices[0];
      const content = choice?.message?.content ?? "";

      const result: CompletionResponse = {
        content,
        model: response.model,
        ...(choice?.finish_reason ? { stopReason: choice.finish_reason } : {}),
        ...(response.usage
          ? {
              usage: {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
              },
            }
          : {}),
      };

      logger.debug(
        {
          provider: this.name,
          model: response.model,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          durationMs: Date.now() - startTime,
        },
        "OpenAI completion successful"
      );

      return result;
    } catch (error) {
      return this.handleError(error, params.model, startTime);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Simple ping using a minimal request
      await this.client.chat.completions.create({
        model: "gpt-4o-mini",
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

    // Handle OpenAI-specific errors
    if (error instanceof OpenAI.APIError) {
      logger.error(
        {
          provider: this.name,
          model,
          status: error.status,
          message: error.message,
          durationMs,
        },
        "OpenAI API error"
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
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      logger.error(
        { provider: this.name, model, durationMs },
        "OpenAI connection timeout"
      );
      throw new LLMTimeoutError(this.name, this.timeoutMs);
    }

    // Handle generic errors
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: this.name, model, error: message, durationMs },
      "OpenAI unexpected error"
    );
    throw new LLMProviderError(
      this.name,
      message,
      error instanceof Error ? error : undefined
    );
  }

  private extractRetryAfter(error: InstanceType<typeof OpenAI.APIError>): number | undefined {
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
