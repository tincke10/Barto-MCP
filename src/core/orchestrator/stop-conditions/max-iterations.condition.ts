import type {
  StopCondition,
  StopConditionContext,
  StopConditionResult,
} from "./stop-condition.interface.js";

/**
 * Max Iterations Stop Condition
 *
 * Stops the workflow when the maximum number of iterations has been reached.
 */
export class MaxIterationsStopCondition implements StopCondition {
  readonly name = "max_iterations";

  evaluate(context: StopConditionContext): StopConditionResult {
    const { currentIteration, maxIterations } = context;

    if (currentIteration >= maxIterations) {
      return {
        shouldStop: true,
        reason: "max_iterations",
        message: `Reached maximum iterations (${maxIterations})`,
      };
    }

    return { shouldStop: false };
  }
}
