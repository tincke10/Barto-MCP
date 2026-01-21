import { AppError } from "./base.error.js";
import type { ZodError } from "zod";

/**
 * Error thrown when input validation fails
 */
export class InputValidationError extends AppError {
  readonly code = "INPUT_VALIDATION_ERROR";
  readonly statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(`Input validation failed: ${message}`, details);
  }

  /**
   * Create from Zod validation error
   */
  static fromZodError(error: ZodError): InputValidationError {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return new InputValidationError("Schema validation failed", { issues });
  }
}

/**
 * Error thrown when maximum cost is exceeded
 */
export class MaxCostExceededError extends AppError {
  readonly code = "MAX_COST_EXCEEDED";
  readonly statusCode = 400;

  constructor(estimatedCost: number, maxCost: number) {
    super(
      `Estimated cost $${estimatedCost.toFixed(2)} exceeds maximum allowed $${maxCost.toFixed(2)}`,
      { estimatedCost, maxCost }
    );
  }
}

/**
 * Error thrown when input size exceeds limit
 */
export class InputSizeExceededError extends AppError {
  readonly code = "INPUT_SIZE_EXCEEDED";
  readonly statusCode = 400;

  constructor(field: string, size: number, maxSize: number) {
    super(`Field '${field}' size ${size} bytes exceeds maximum ${maxSize} bytes`, {
      field,
      size,
      maxSize,
    });
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitExceededError extends AppError {
  readonly code = "RATE_LIMIT_EXCEEDED";
  readonly statusCode = 429;

  constructor(retryAfterSeconds?: number) {
    super("Rate limit exceeded. Please try again later.", {
      retryAfterSeconds,
    });
  }
}

/**
 * Error thrown when criteria count exceeds limit
 */
export class CriteriaCountExceededError extends AppError {
  readonly code = "CRITERIA_COUNT_EXCEEDED";
  readonly statusCode = 400;

  constructor(count: number, maxCount: number) {
    super(`Criteria count ${count} exceeds maximum ${maxCount}`, {
      count,
      maxCount,
    });
  }
}
