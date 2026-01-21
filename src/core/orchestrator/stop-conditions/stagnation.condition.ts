import type {
  StopCondition,
  StopConditionContext,
  StopConditionResult,
} from "./stop-condition.interface.js";

/**
 * Configuration for stagnation detection
 */
export interface StagnationConfig {
  /** Number of iterations without improvement before stopping (default: 3) */
  maxStagnantIterations?: number;
  /** Minimum improvement threshold to not be considered stagnant (default: 0.01 = 1%) */
  improvementThreshold?: number;
}

/**
 * Stagnation Stop Condition
 *
 * Stops the workflow when the score has not improved significantly
 * for a specified number of consecutive iterations.
 *
 * This prevents wasting resources when the model is stuck.
 */
export class StagnationStopCondition implements StopCondition {
  readonly name = "stagnation";

  private readonly maxStagnantIterations: number;
  private readonly improvementThreshold: number;

  constructor(config: StagnationConfig = {}) {
    this.maxStagnantIterations = config.maxStagnantIterations ?? 3;
    this.improvementThreshold = config.improvementThreshold ?? 0.01;
  }

  evaluate(context: StopConditionContext): StopConditionResult {
    const { iterations } = context;

    // Need at least maxStagnantIterations + 1 iterations to detect stagnation
    if (iterations.length < this.maxStagnantIterations + 1) {
      return { shouldStop: false };
    }

    // Get the last N+1 scores to check for stagnation
    const recentIterations = iterations.slice(-this.maxStagnantIterations - 1);
    const recentScores = recentIterations.map((iter) => iter.feedback.score);

    // Check if scores have improved
    const baselineScore = recentScores[0];
    if (baselineScore === undefined) {
      return { shouldStop: false };
    }

    const hasImprovement = recentScores.slice(1).some((score) => {
      return score - baselineScore > this.improvementThreshold;
    });

    if (!hasImprovement) {
      const lastScores = recentScores.map((s) => (s * 100).toFixed(1) + "%").join(", ");
      return {
        shouldStop: true,
        reason: "stagnation",
        message: `No significant improvement in last ${this.maxStagnantIterations} iterations. Scores: [${lastScores}]`,
      };
    }

    return { shouldStop: false };
  }
}
