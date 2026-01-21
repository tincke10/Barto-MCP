import { envSchema, type EnvConfig } from "./env.js";

let _config: EnvConfig | null = null;

/**
 * Load and validate configuration from environment variables.
 * This should be called once at application startup.
 *
 * @returns Validated configuration object
 * @throws Error if validation fails
 */
export function loadConfig(): EnvConfig {
  if (_config) {
    return _config;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Configuration validation failed:");
    console.error(result.error.format());
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

/**
 * Get the current configuration.
 * Throws if config hasn't been loaded yet.
 *
 * @returns Validated configuration object
 * @throws Error if config not loaded
 */
export function getConfig(): EnvConfig {
  if (!_config) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }
  return _config;
}

/**
 * Reset configuration (useful for testing)
 */
export function resetConfig(): void {
  _config = null;
}

/**
 * Proxy for convenient config access.
 * Automatically calls getConfig() when accessing properties.
 */
export const config = new Proxy({} as EnvConfig, {
  get(_, prop: string) {
    return getConfig()[prop as keyof EnvConfig];
  },
});

/**
 * Derived configuration values for easy access
 */
export function getDerivedConfig() {
  const env = getConfig();
  return {
    isDevelopment: env.NODE_ENV === "development",
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",

    // LLM
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    llmProvider: env.DEFAULT_LLM_PROVIDER,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,

    // Storage
    redisUrl: env.REDIS_URL,
    databaseUrl: env.DATABASE_URL,

    // Limits
    maxIterationsLimit: env.MAX_ITERATIONS_LIMIT,
    defaultScoreThreshold: env.DEFAULT_SCORE_THRESHOLD,
    maxCostPerWorkflowUsd: env.MAX_COST_PER_WORKFLOW_USD,
    maxInputSizeBytes: env.MAX_INPUT_SIZE_BYTES,
    maxCriteriaCount: env.MAX_CRITERIA_COUNT,

    // Rate Limiting
    rateLimitRequestsPerMinute: env.RATE_LIMIT_REQUESTS_PER_MINUTE,
    rateLimitBurst: env.RATE_LIMIT_BURST,

    // Observability
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: env.OTEL_SERVICE_NAME,
    logLevel: env.LOG_LEVEL,
  } as const;
}

export type DerivedConfig = ReturnType<typeof getDerivedConfig>;
export type { EnvConfig };
