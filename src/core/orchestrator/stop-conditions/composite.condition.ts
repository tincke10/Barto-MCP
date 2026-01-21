import type {
  StopCondition,
  StopConditionContext,
  StopConditionResult,
} from "./stop-condition.interface.js";
import { ThresholdStopCondition } from "./threshold.condition.js";
import { MaxIterationsStopCondition } from "./max-iterations.condition.js";
import { StagnationStopCondition, type StagnationConfig } from "./stagnation.condition.js";
import {
  EarlyTerminationStopCondition,
  type EarlyTerminationConfig,
} from "./early-termination.condition.js";

/**
 * Composite Stop Condition
 *
 * Combines multiple stop conditions and evaluates them in order.
 * The first condition that triggers a stop wins.
 *
 * Default evaluation order:
 * 1. Threshold reached (success case)
 * 2. Max iterations (limit case)
 * 3. Stagnation (optimization)
 * 4. Early termination (failure case)
 */
export class CompositeStopCondition implements StopCondition {
  readonly name = "composite";

  private conditions: StopCondition[];

  constructor(conditions: StopCondition[]) {
    this.conditions = conditions;
  }

  evaluate(context: StopConditionContext): StopConditionResult {
    for (const condition of this.conditions) {
      const result = condition.evaluate(context);
      if (result.shouldStop) {
        return {
          ...result,
          message: `[${condition.name}] ${result.message ?? ""}`,
        };
      }
    }

    return { shouldStop: false };
  }

  /**
   * Add a condition to the composite
   */
  addCondition(condition: StopCondition): void {
    this.conditions.push(condition);
  }

  /**
   * Remove a condition by name
   */
  removeCondition(name: string): void {
    this.conditions = this.conditions.filter((c) => c.name !== name);
  }
}

/**
 * Configuration for creating default stop conditions
 */
export interface DefaultStopConditionsConfig {
  /** Configuration for stagnation detection */
  stagnation?: StagnationConfig;
  /** Configuration for early termination */
  earlyTermination?: EarlyTerminationConfig;
  /** Whether to include stagnation detection (default: true) */
  includeStagnation?: boolean;
  /** Whether to include early termination (default: true) */
  includeEarlyTermination?: boolean;
}

/**
 * Create a composite stop condition with sensible defaults
 *
 * @param config - Optional configuration
 * @returns Configured composite stop condition
 */
export function createDefaultStopConditions(
  config: DefaultStopConditionsConfig = {}
): CompositeStopCondition {
  const conditions: StopCondition[] = [
    new ThresholdStopCondition(),
    new MaxIterationsStopCondition(),
  ];

  if (config.includeStagnation !== false) {
    conditions.push(new StagnationStopCondition(config.stagnation));
  }

  if (config.includeEarlyTermination !== false) {
    conditions.push(new EarlyTerminationStopCondition(config.earlyTermination));
  }

  return new CompositeStopCondition(conditions);
}
