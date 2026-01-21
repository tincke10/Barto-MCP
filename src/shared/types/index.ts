/**
 * Result type for functional error handling
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Result utility functions
 */
export const Result = {
  /**
   * Create a successful result
   */
  ok<T>(data: T): Result<T, never> {
    return { success: true, data };
  },

  /**
   * Create a failed result
   */
  err<E>(error: E): Result<never, E> {
    return { success: false, error };
  },

  /**
   * Map over a successful result
   */
  map<T, U, E>(result: Result<T, E>, fn: (data: T) => U): Result<U, E> {
    if (result.success) {
      return Result.ok(fn(result.data));
    }
    return result;
  },

  /**
   * FlatMap over a successful result
   */
  flatMap<T, U, E>(result: Result<T, E>, fn: (data: T) => Result<U, E>): Result<U, E> {
    if (result.success) {
      return fn(result.data);
    }
    return result;
  },

  /**
   * Create a result from a promise
   */
  async fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
    try {
      const data = await promise;
      return Result.ok(data);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  },

  /**
   * Unwrap a result, throwing if it's an error
   */
  unwrap<T, E>(result: Result<T, E>): T {
    if (result.success) {
      return result.data;
    }
    throw result.error;
  },

  /**
   * Unwrap a result with a default value
   */
  unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    if (result.success) {
      return result.data;
    }
    return defaultValue;
  },

  /**
   * Check if result is successful
   */
  isOk<T, E>(result: Result<T, E>): result is { success: true; data: T } {
    return result.success;
  },

  /**
   * Check if result is an error
   */
  isErr<T, E>(result: Result<T, E>): result is { success: false; error: E } {
    return !result.success;
  },
};

/**
 * LLM Provider type
 */
export type LLMProviderType = "anthropic" | "openai";

/**
 * Workflow status
 */
export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Stop reason for workflow
 */
export type StopReason = "threshold_reached" | "max_iterations" | "stagnation" | "error" | "cancelled" | "early_termination";

/**
 * Tool execution mode
 */
export type ExecutionMode = "sync" | "async";
