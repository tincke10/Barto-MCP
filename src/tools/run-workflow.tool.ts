import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "./index.js";
import type { DerivedConfig } from "../config/index.js";
import { WorkflowRequestSchema } from "../schemas/workflow.schema.js";
import { RalphOrchestrator } from "../core/orchestrator/index.js";
import type { LLMProviderType } from "../infrastructure/llm/index.js";
import { logger } from "../shared/utils/logger.js";
import {
  InputValidationError,
  MaxCostExceededError,
  CriteriaCountExceededError,
  InputSizeExceededError,
  RateLimitExceededError,
} from "../shared/errors/index.js";
import {
  MODEL_COSTS_PER_1K_TOKENS,
  ESTIMATED_TOKENS_PER_ITERATION,
} from "../shared/constants/index.js";
import { sanitizeTask, sanitizeCriteria } from "../shared/utils/prompt-sanitizer.js";
import { getWorkflowRateLimiter } from "../shared/utils/rate-limiter.js";

/**
 * Input schema for run_workflow tool
 */
const InputSchema = WorkflowRequestSchema;

/**
 * Estimate workflow cost based on model and iterations
 */
function estimateCost(iterations: number, generatorModel: string, discriminatorModel: string): number {
  // Get costs for models, default to Sonnet pricing if unknown
  const genCosts = MODEL_COSTS_PER_1K_TOKENS[generatorModel as keyof typeof MODEL_COSTS_PER_1K_TOKENS] ?? {
    input: 0.003,
    output: 0.015,
  };
  const discCosts = MODEL_COSTS_PER_1K_TOKENS[discriminatorModel as keyof typeof MODEL_COSTS_PER_1K_TOKENS] ?? {
    input: 0.003,
    output: 0.015,
  };

  // Estimate tokens per iteration
  const genTokens = ESTIMATED_TOKENS_PER_ITERATION.generator;
  const discTokens = ESTIMATED_TOKENS_PER_ITERATION.discriminator;

  // Calculate cost per iteration
  const genCostPerIter = (genTokens * (genCosts.input + genCosts.output)) / 1000;
  const discCostPerIter = (discTokens * (discCosts.input + discCosts.output)) / 1000;

  return iterations * (genCostPerIter + discCostPerIter);
}

/**
 * Determine provider type from model name
 */
function getProviderFromModel(model: string): LLMProviderType {
  if (model.startsWith("claude") || model.startsWith("anthropic")) {
    return "anthropic";
  }
  if (model.startsWith("gpt") || model.startsWith("o1")) {
    return "openai";
  }
  // Default to anthropic
  return "anthropic";
}

/**
 * Run workflow tool - executes the generator-discriminator loop
 */
export const runWorkflowTool: Tool = {
  name: "run_workflow",
  description: `Execute an iterative generator-discriminator workflow (Ralph Loop).

The generator creates content based on the task, the discriminator evaluates it against the criteria, and the loop continues until the quality threshold is reached or max iterations are exhausted.

Parameters:
- task: The task description for the generator
- criteria: List of criteria for the discriminator to evaluate
- maxIterations: Maximum loop iterations (default: 10, max: 50)
- scoreThreshold: Minimum score to consider successful (0-1, default: 0.85)
- mode: 'sync' waits for result, 'async' returns job_id immediately
- generatorModel: LLM model for generation
- discriminatorModel: LLM model for evaluation`,

  inputSchema: zodToJsonSchema(InputSchema, "WorkflowRequest") as Record<string, unknown>,

  execute: async (args: unknown, config: DerivedConfig) => {
    // Validate input
    const parseResult = InputSchema.safeParse(args);
    if (!parseResult.success) {
      throw InputValidationError.fromZodError(parseResult.error);
    }

    const input = parseResult.data;

    // Generate client ID (in a real scenario, this would come from auth context)
    const clientId = "default-client";

    // Check rate limit
    const rateLimiter = getWorkflowRateLimiter();
    const rateLimitResult = await rateLimiter.check(clientId);
    if (!rateLimitResult.allowed) {
      logger.warn(
        { clientId, resetInSeconds: rateLimitResult.resetInSeconds },
        "Rate limit exceeded for workflow execution"
      );
      throw new RateLimitExceededError(rateLimitResult.resetInSeconds);
    }

    // Sanitize task input against prompt injection
    const taskSanitization = sanitizeTask(input.task, { mode: "sanitize" });
    if (!taskSanitization.isSafe) {
      logger.warn(
        { clientId, threatCount: taskSanitization.threats.length },
        "Suspicious patterns detected in task input"
      );
    }

    // Sanitize criteria
    const criteriaSanitization = sanitizeCriteria(input.criteria, { mode: "sanitize" });
    if (!criteriaSanitization.allSafe) {
      logger.warn(
        { clientId, totalThreats: criteriaSanitization.totalThreats },
        "Suspicious patterns detected in criteria"
      );
    }
    const sanitizedCriteria = criteriaSanitization.results.map((r) => r.sanitized);

    // Validate input size
    const taskSize = Buffer.byteLength(taskSanitization.sanitized, "utf8");
    if (taskSize > config.maxInputSizeBytes) {
      throw new InputSizeExceededError("task", taskSize, config.maxInputSizeBytes);
    }

    // Validate criteria count
    if (sanitizedCriteria.length > config.maxCriteriaCount) {
      throw new CriteriaCountExceededError(sanitizedCriteria.length, config.maxCriteriaCount);
    }

    // Validate max iterations
    if (input.maxIterations > config.maxIterationsLimit) {
      throw new InputValidationError(
        `maxIterations ${input.maxIterations} exceeds limit ${config.maxIterationsLimit}`
      );
    }

    // Estimate cost
    const estimatedCost = estimateCost(
      input.maxIterations,
      input.generatorModel,
      input.discriminatorModel
    );
    if (estimatedCost > config.maxCostPerWorkflowUsd) {
      throw new MaxCostExceededError(estimatedCost, config.maxCostPerWorkflowUsd);
    }

    logger.info(
      {
        task: taskSanitization.sanitized.slice(0, 100),
        criteriaCount: sanitizedCriteria.length,
        maxIterations: input.maxIterations,
        mode: input.mode,
        generatorModel: input.generatorModel,
        discriminatorModel: input.discriminatorModel,
        estimatedCost,
        rateLimitRemaining: rateLimitResult.remaining,
      },
      "Starting workflow"
    );

    // Determine provider from model
    const providerType = getProviderFromModel(input.generatorModel);

    // Create orchestrator
    const orchestrator = new RalphOrchestrator({
      generatorModel: input.generatorModel,
      discriminatorModel: input.discriminatorModel,
      providerType,
    });

    // Handle async mode
    if (input.mode === "async") {
      const workflowId = await orchestrator.enqueue(
        {
          task: taskSanitization.sanitized,
          criteria: sanitizedCriteria,
          maxIterations: input.maxIterations,
          scoreThreshold: input.scoreThreshold,
        },
        clientId
      );

      return {
        status: "queued",
        workflowId,
        message: "Workflow queued. Use get_status to check progress.",
        estimatedCostUsd: estimatedCost,
      };
    }

    // Sync mode: execute and wait for result
    const result = await orchestrator.execute({
      task: taskSanitization.sanitized,
      criteria: sanitizedCriteria,
      maxIterations: input.maxIterations,
      scoreThreshold: input.scoreThreshold,
    });

    return {
      success: result.success,
      workflowId: result.workflowId,
      output: result.output,
      iterations: result.iterations,
      finalScore: result.finalScore,
      totalDurationMs: result.totalDurationMs,
      reason: result.reason,
      estimatedCostUsd: estimatedCost,
      // Include iteration summary (not full history to keep response manageable)
      iterationSummary: result.iterationHistory?.map((iter) => ({
        number: iter.number,
        score: iter.feedback.score,
        passed: iter.feedback.passed,
        durationMs: iter.durationMs,
      })),
    };
  },
};
