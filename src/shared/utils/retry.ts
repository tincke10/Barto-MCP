import { logger } from "./logger.js";

/**
 * Configuration options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Add randomness to delay (jitter) to prevent thundering herd (default: true) */
  jitter?: boolean;
  /** Function to determine if an error should trigger a retry */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback called before each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Default retry options
 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "shouldRetry" | "onRetry">> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Default function to determine if an error should trigger a retry
 *
 * Retries on:
 * - Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
 * - Rate limit errors (429)
 * - Server errors (5xx)
 *
 * Does NOT retry on:
 * - Client errors (4xx except 429)
 * - Validation errors
 * - Authentication errors
 */
function defaultShouldRetry(error: unknown, _attempt: number): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes("econnrefused") ||
      message.includes("etimedout") ||
      message.includes("enotfound") ||
      message.includes("network") ||
      message.includes("socket")
    ) {
      return true;
    }

    // Rate limit
    if (message.includes("rate limit") || message.includes("429")) {
      return true;
    }

    // Server errors
    if (message.includes("500") || message.includes("502") || message.includes("503")) {
      return true;
    }

    // Timeout errors
    if (message.includes("timeout")) {
      return true;
    }
  }

  // Check for HTTP status code in error object
  if (typeof error === "object" && error !== null) {
    const statusCode = (error as { status?: number; statusCode?: number }).status ??
      (error as { status?: number; statusCode?: number }).statusCode;

    if (statusCode !== undefined) {
      // Retry on rate limit and server errors
      return statusCode === 429 || statusCode >= 500;
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 *
 * @param attempt - Current attempt number (1-based)
 * @param options - Retry options
 * @returns Delay in milliseconds
 */
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, "shouldRetry" | "onRetry">>
): number {
  // Exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
  const exponentialDelay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  // Add jitter (0-100% of delay) to prevent thundering herd
  if (options.jitter) {
    const jitterRange = cappedDelay * Math.random();
    return Math.floor(cappedDelay + jitterRange);
  }

  return Math.floor(cappedDelay);
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retry on failure
 *
 * Uses exponential backoff with jitter to handle transient failures.
 *
 * @param fn - Function to execute
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retries fail
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   () => fetchData(),
 *   { maxAttempts: 3, initialDelayMs: 1000 }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if this is the last attempt
      if (attempt === opts.maxAttempts) {
        logger.warn(
          {
            attempt,
            maxAttempts: opts.maxAttempts,
            error: error instanceof Error ? error.message : String(error),
          },
          "All retry attempts exhausted"
        );
        throw error;
      }

      // Check if we should retry this error
      if (!shouldRetry(error, attempt)) {
        logger.debug(
          {
            attempt,
            error: error instanceof Error ? error.message : String(error),
          },
          "Error is not retryable"
        );
        throw error;
      }

      // Calculate delay for next attempt
      const delayMs = calculateDelay(attempt, opts);

      // Call onRetry callback if provided
      options.onRetry?.(error, attempt, delayMs);

      logger.debug(
        {
          attempt,
          maxAttempts: opts.maxAttempts,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retrying after delay"
      );

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retry wrapper with pre-configured options
 *
 * Useful when you want to reuse the same retry configuration across multiple calls.
 *
 * @param defaultOptions - Default retry options
 * @returns A retry function with pre-configured options
 *
 * @example
 * ```typescript
 * const retryWithBackoff = createRetry({ maxAttempts: 5 });
 * const result = await retryWithBackoff(() => fetchData());
 * ```
 */
export function createRetry(defaultOptions: RetryOptions) {
  return <T>(fn: () => Promise<T>, overrideOptions?: RetryOptions): Promise<T> => {
    return retry(fn, { ...defaultOptions, ...overrideOptions });
  };
}

/**
 * Decorator-style retry for class methods
 *
 * @param options - Retry options
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * class ApiClient {
 *   @withRetry({ maxAttempts: 3 })
 *   async fetchData() {
 *     // ...
 *   }
 * }
 * ```
 */
export function withRetry(options: RetryOptions = {}) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: unknown,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;

    if (!originalMethod) {
      return descriptor;
    }

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return retry(() => originalMethod.apply(this, args), options);
    } as T;

    return descriptor;
  };
}
