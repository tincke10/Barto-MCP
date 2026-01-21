import type {
  StopCondition,
  StopConditionContext,
  StopConditionResult,
} from "./stop-condition.interface.js";

/**
 * Threshold Stop Condition
 *
 * Stops the workflow when the score meets or exceeds the target threshold
 * AND the discriminator has marked the output as passed.
 */
export class ThresholdStopCondition implements StopCondition {
  readonly name = "threshold";

  evaluate(context: StopConditionContext): StopConditionResult {
    const { currentScore, currentPassed, scoreThreshold } = context;

    if (currentPassed && currentScore >= scoreThreshold) {
      return {
        shouldStop: true,
        reason: "threshold_reached",
        message: `Score ${(currentScore * 100).toFixed(1)}% meets threshold ${(scoreThreshold * 100).toFixed(1)}%`,
      };
    }

    return { shouldStop: false };
  }
}
