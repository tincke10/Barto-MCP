import type { LLMProvider, CompletionResponse } from "../../infrastructure/llm/index.js";
import { retry, type RetryOptions } from "../../shared/utils/retry.js";
import { logger } from "../../shared/utils/logger.js";

/**
 * Base configuration for all runners
 */
export interface BaseRunnerConfig {
  /** The LLM provider to use */
  provider: LLMProvider;
  /** The model identifier */
  model: string;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Temperature for response variability */
  temperature?: number;
  /** Retry configuration */
  retryOptions?: RetryOptions;
}

/**
 * Result from a runner execution
 */
export interface RunnerResult {
  /** The generated content */
  content: string;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Abstract base class for all runners
 *
 * Provides common functionality for Generator and Discriminator runners:
 * - LLM provider integration
 * - Retry logic
 * - Logging and metrics
 */
export abstract class BaseRunner {
  protected readonly provider: LLMProvider;
  protected readonly model: string;
  protected readonly maxTokens: number;
  protected readonly temperature?: number;
  protected readonly retryOptions: RetryOptions;

  constructor(config: BaseRunnerConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 4096;
    if (config.temperature !== undefined) {
      this.temperature = config.temperature;
    }
    this.retryOptions = config.retryOptions ?? {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
    };
  }

  /**
   * Execute a completion with the LLM provider
   *
   * @param systemPrompt - System prompt for the LLM
   * @param userPrompt - User prompt for the LLM
   * @returns Runner result with content and metadata
   */
  protected async executeCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<RunnerResult> {
    const startTime = Date.now();

    const response = await retry<CompletionResponse>(
      () =>
        this.provider.complete({
          model: this.model,
          systemPrompt,
          userPrompt,
          maxTokens: this.maxTokens,
          ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        }),
      {
        ...this.retryOptions,
        onRetry: (error, attempt, delayMs) => {
          logger.warn(
            {
              runner: this.constructor.name,
              model: this.model,
              attempt,
              delayMs,
              error: error instanceof Error ? error.message : String(error),
            },
            "Retrying LLM completion"
          );
        },
      }
    );

    return {
      content: response.content,
      ...(response.usage ? { usage: response.usage } : {}),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Get the runner name for logging
   */
  protected get runnerName(): string {
    return this.constructor.name;
  }
}
