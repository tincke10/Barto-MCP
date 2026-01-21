// Interface
export type {
  StopCondition,
  StopConditionContext,
  StopConditionResult,
} from "./stop-condition.interface.js";

// Implementations
export { ThresholdStopCondition } from "./threshold.condition.js";
export { MaxIterationsStopCondition } from "./max-iterations.condition.js";
export {
  StagnationStopCondition,
  type StagnationConfig,
} from "./stagnation.condition.js";
export {
  EarlyTerminationStopCondition,
  type EarlyTerminationConfig,
} from "./early-termination.condition.js";
export {
  CompositeStopCondition,
  createDefaultStopConditions,
  type DefaultStopConditionsConfig,
} from "./composite.condition.js";
