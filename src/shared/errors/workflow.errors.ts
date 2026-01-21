import { AppError } from "./base.error.js";

/**
 * Error thrown when a workflow is not found
 */
export class WorkflowNotFoundError extends AppError {
  readonly code = "WORKFLOW_NOT_FOUND";
  readonly statusCode = 404;

  constructor(workflowId: string) {
    super(`Workflow with ID ${workflowId} not found`, { workflowId });
  }
}

/**
 * Error thrown when max iterations limit is exceeded
 */
export class MaxIterationsExceededError extends AppError {
  readonly code = "MAX_ITERATIONS_EXCEEDED";
  readonly statusCode = 400;

  constructor(requested: number, maximum: number) {
    super(`Requested ${requested} iterations exceeds maximum of ${maximum}`, {
      requested,
      maximum,
    });
  }
}

/**
 * Error thrown when workflow execution fails
 */
export class WorkflowExecutionError extends AppError {
  readonly code = "WORKFLOW_EXECUTION_ERROR";
  readonly statusCode = 500;

  constructor(workflowId: string, cause: Error) {
    super(`Workflow ${workflowId} failed: ${cause.message}`, {
      workflowId,
      originalError: cause.message,
    });
    this.cause = cause;
  }
}

/**
 * Error thrown when workflow is cancelled
 */
export class WorkflowCancelledError extends AppError {
  readonly code = "WORKFLOW_CANCELLED";
  readonly statusCode = 499;

  constructor(workflowId: string) {
    super(`Workflow ${workflowId} was cancelled`, { workflowId });
  }
}

/**
 * Error thrown when workflow is already running
 */
export class WorkflowAlreadyRunningError extends AppError {
  readonly code = "WORKFLOW_ALREADY_RUNNING";
  readonly statusCode = 409;

  constructor(workflowId: string) {
    super(`Workflow ${workflowId} is already running`, { workflowId });
  }
}

/**
 * Error thrown when workflow stagnates (no improvement)
 */
export class WorkflowStagnationError extends AppError {
  readonly code = "WORKFLOW_STAGNATION";
  readonly statusCode = 422;

  constructor(workflowId: string, iterations: number, lastScores: number[]) {
    super(
      `Workflow ${workflowId} stagnated after ${iterations} iterations with no improvement`,
      { workflowId, iterations, lastScores }
    );
  }
}
