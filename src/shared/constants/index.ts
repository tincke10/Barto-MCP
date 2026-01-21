/**
 * Default configuration values
 */
export const DEFAULTS = {
  MAX_ITERATIONS: 10,
  SCORE_THRESHOLD: 0.85,
  LLM_TIMEOUT_MS: 60000,
  CACHE_TTL_SECONDS: 3600,
  MAX_INPUT_SIZE_BYTES: 10240,
  MAX_CRITERIA_COUNT: 20,
} as const;

/**
 * LLM Model identifiers
 */
export const MODELS = {
  ANTHROPIC: {
    CLAUDE_OPUS_4: "claude-opus-4-20250514",
    CLAUDE_SONNET_4: "claude-sonnet-4-20250514",
    CLAUDE_HAIKU_35: "claude-haiku-3-5-20241022",
  },
  OPENAI: {
    GPT4_TURBO: "gpt-4-turbo",
    GPT4O: "gpt-4o",
    GPT4O_MINI: "gpt-4o-mini",
  },
} as const;

/**
 * Cost per 1K tokens for different models (approximate)
 */
export const MODEL_COSTS_PER_1K_TOKENS = {
  // Anthropic (input/output)
  "claude-opus-4-20250514": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-20250514": { input: 0.003, output: 0.015 },
  "claude-haiku-3-5-20241022": { input: 0.0008, output: 0.004 },
  // OpenAI
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
} as const;

/**
 * Average tokens per iteration (estimated)
 */
export const ESTIMATED_TOKENS_PER_ITERATION = {
  generator: 2000,
  discriminator: 1000,
} as const;

/**
 * Workflow status values
 */
export const WORKFLOW_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

/**
 * Stop reasons
 */
export const STOP_REASONS = {
  THRESHOLD_REACHED: "threshold_reached",
  MAX_ITERATIONS: "max_iterations",
  STAGNATION: "stagnation",
  ERROR: "error",
  CANCELLED: "cancelled",
  EARLY_TERMINATION: "early_termination",
} as const;

/**
 * Redis key prefixes
 */
export const REDIS_KEYS = {
  WORKFLOW_STATE: "workflow:state:",
  WORKFLOW_LOCK: "workflow:lock:",
  RATE_LIMIT: "ratelimit:",
  CACHE: "cache:llm:",
} as const;

/**
 * Queue names
 */
export const QUEUES = {
  WORKFLOW_EXECUTION: "workflow:execution",
} as const;

/**
 * Event names
 */
export const EVENTS = {
  WORKFLOW_STARTED: "workflow.started",
  WORKFLOW_COMPLETED: "workflow.completed",
  WORKFLOW_FAILED: "workflow.failed",
  WORKFLOW_CANCELLED: "workflow.cancelled",
  ITERATION_STARTED: "iteration.started",
  ITERATION_COMPLETED: "iteration.completed",
} as const;
