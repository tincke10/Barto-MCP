import type {
  StopCondition,
  StopConditionContext,
  StopConditionResult,
} from "./stop-condition.interface.js";

/**
 * Configuration for early termination
 */
export interface EarlyTerminationConfig {
  /** Score threshold below which early termination may occur (default: 0.1) */
  scoreThreshold?: number;
  /** Minimum iterations before early termination can happen (default: 2) */
  minIterations?: number;
}

/**
 * Early Termination Stop Condition
 *
 * Stops the workflow early if the score is extremely low after
 * a minimum number of iterations, indicating that the task may
 * be fundamentally unsolvable or the criteria are too strict.
 *
 * This prevents wasting resources on hopeless cases.
 */
export class EarlyTerminationStopCondition implements StopCondition {
  readonly name = "early_termination";

  private readonly scoreThreshold: number;
  private readonly minIterations: number;

  constructor(config: EarlyTerminationConfig = {}) {
    this.scoreThreshold = config.scoreThreshold ?? 0.1;
    this.minIterations = config.minIterations ?? 2;
  }

  evaluate(context: StopConditionContext): StopConditionResult {
    const { currentIteration, currentScore } = context;

    // Don't terminate early in the first few iterations
    if (currentIteration < this.minIterations) {
      return { shouldStop: false };
    }

    // Check if score is critically low
    if (currentScore < this.scoreThreshold) {
      return {
        shouldStop: true,
        reason: "early_termination",
        message: `Score ${(currentScore * 100).toFixed(1)}% is below minimum threshold ${(this.scoreThreshold * 100).toFixed(1)}% after ${currentIteration} iterations`,
      };
    }

    return { shouldStop: false };
  }
}
