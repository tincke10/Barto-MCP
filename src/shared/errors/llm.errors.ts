import { AppError } from "./base.error.js";

/**
 * Base error for LLM provider issues
 */
export class LLMProviderError extends AppError {
  readonly code = "LLM_PROVIDER_ERROR";
  readonly statusCode = 502;

  constructor(provider: string, message: string, cause?: Error) {
    super(`LLM provider ${provider} error: ${message}`, {
      provider,
      originalError: cause?.message,
    });
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Error thrown when LLM request times out
 */
export class LLMTimeoutError extends AppError {
  readonly code = "LLM_TIMEOUT";
  readonly statusCode = 504;

  constructor(provider: string, timeoutMs: number) {
    super(`LLM request to ${provider} timed out after ${timeoutMs}ms`, {
      provider,
      timeoutMs,
    });
  }
}

/**
 * Error thrown when LLM rate limit is hit
 */
export class LLMRateLimitError extends AppError {
  readonly code = "LLM_RATE_LIMIT";
  readonly statusCode = 429;

  constructor(provider: string, retryAfterMs?: number) {
    super(`Rate limit exceeded for ${provider}`, {
      provider,
      retryAfterMs,
    });
  }
}

/**
 * Error thrown when LLM response cannot be parsed
 */
export class LLMParseError extends AppError {
  readonly code = "LLM_PARSE_ERROR";
  readonly statusCode = 422;

  constructor(message: string, rawResponse?: string) {
    super(`Failed to parse LLM response: ${message}`, {
      rawResponse: rawResponse?.slice(0, 500), // Truncate for safety
    });
  }
}

/**
 * Error thrown when LLM authentication fails
 */
export class LLMAuthenticationError extends AppError {
  readonly code = "LLM_AUTHENTICATION_ERROR";
  readonly statusCode = 401;

  constructor(provider: string) {
    super(`Authentication failed for ${provider}. Check your API key.`, {
      provider,
    });
  }
}

/**
 * Error thrown when LLM model is not available
 */
export class LLMModelNotFoundError extends AppError {
  readonly code = "LLM_MODEL_NOT_FOUND";
  readonly statusCode = 404;

  constructor(provider: string, model: string) {
    super(`Model ${model} not found for provider ${provider}`, {
      provider,
      model,
    });
  }
}
