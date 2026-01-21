import { z } from "zod";

/**
 * Environment variable schema with validation
 */
export const envSchema = z.object({
  // Environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // LLM Providers
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  OPENAI_API_KEY: z.string().optional(),
  DEFAULT_LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // PostgreSQL
  DATABASE_URL: z.string().optional(),

  // Workflow Limits
  MAX_ITERATIONS_LIMIT: z.coerce.number().int().min(1).max(100).default(50),
  DEFAULT_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  MAX_COST_PER_WORKFLOW_USD: z.coerce.number().min(0).default(1.0),

  // LLM Configuration
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(3600),

  // Rate Limiting
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_BURST: z.coerce.number().int().min(1).default(5),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default("mcp-ralph-workflow"),

  // Security
  MAX_INPUT_SIZE_BYTES: z.coerce.number().int().min(1024).default(10240),
  MAX_CRITERIA_COUNT: z.coerce.number().int().min(1).default(20),
});

export type EnvConfig = z.infer<typeof envSchema>;
