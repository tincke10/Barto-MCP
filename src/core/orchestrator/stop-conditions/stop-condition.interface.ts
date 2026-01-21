import type { IterationState } from "../../../schemas/workflow.schema.js";

/**
 * Result from evaluating a stop condition
 */
export interface StopConditionResult {
  /** Whether the condition is met (workflow should stop) */
  shouldStop: boolean;
  /** Reason for stopping (if applicable) */
  reason?: "threshold_reached" | "max_iterations" | "stagnation" | "early_termination";
  /** Additional message explaining the stop decision */
  message?: string;
}

/**
 * Context provided to stop conditions for evaluation
 */
export interface StopConditionContext {
  /** Current iteration number (1-based) */
  currentIteration: number;
  /** Maximum allowed iterations */
  maxIterations: number;
  /** Target score threshold */
  scoreThreshold: number;
  /** History of all completed iterations */
  iterations: IterationState[];
  /** Current/latest score */
  currentScore: number;
  /** Whether current iteration passed */
  currentPassed: boolean;
}

/**
 * Interface for stop condition implementations
 *
 * Stop conditions determine when a workflow should terminate.
 * They can be composed to create complex stopping logic.
 */
export interface StopCondition {
  /** Unique name for this condition */
  readonly name: string;

  /**
   * Evaluate whether the workflow should stop
   *
   * @param context - Current workflow context
   * @returns Result indicating if workflow should stop
   */
  evaluate(context: StopConditionContext): StopConditionResult;
}
