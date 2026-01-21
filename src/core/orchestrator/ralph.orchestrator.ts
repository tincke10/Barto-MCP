import { randomUUID } from "crypto";
import { GeneratorRunner } from "../runners/generator.runner.js";
import { DiscriminatorRunner } from "../runners/discriminator.runner.js";
import type { LLMProviderType } from "../../infrastructure/llm/index.js";
import { getLLMProvider } from "../../infrastructure/llm/index.js";
import {
  createDefaultStopConditions,
  type StopCondition,
  type StopConditionContext,
} from "./stop-conditions/index.js";
import type {
  WorkflowResult,
  IterationState,
  DiscriminatorFeedback,
} from "../../schemas/workflow.schema.js";
import type { StopReason } from "../../shared/types/index.js";
import { WorkflowExecutionError } from "../../shared/errors/index.js";
import { logger } from "../../shared/utils/logger.js";
import { getWorkflowQueue } from "../../infrastructure/queue/index.js";

/**
 * Configuration for the Ralph Orchestrator
 */
export interface OrchestratorConfig {
  /** Model for the generator */
  generatorModel: string;
  /** Model for the discriminator */
  discriminatorModel: string;
  /** LLM provider type */
  providerType: LLMProviderType;
  /** Custom stop conditions (optional, uses defaults if not provided) */
  stopConditions?: StopCondition;
}

/**
 * Parameters for workflow execution
 */
export interface ExecuteParams {
  /** The task to perform */
  task: string;
  /** Evaluation criteria */
  criteria: string[];
  /** Maximum number of iterations */
  maxIterations: number;
  /** Score threshold for success */
  scoreThreshold: number;
}

/**
 * Ralph Orchestrator
 *
 * Orchestrates the iterative generator-discriminator workflow loop.
 *
 * The workflow:
 * 1. Generator produces output based on task and previous feedback
 * 2. Discriminator evaluates output against criteria
 * 3. Loop continues until stop conditions are met
 *
 * Stop conditions include:
 * - Score threshold reached (success)
 * - Maximum iterations reached
 * - Stagnation detected
 * - Early termination for very low scores
 */
export class RalphOrchestrator {
  private generator: GeneratorRunner;
  private discriminator: DiscriminatorRunner;
  private stopConditions: StopCondition;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    const provider = getLLMProvider(config.providerType);

    this.generator = new GeneratorRunner({
      provider,
      model: config.generatorModel,
      maxTokens: 4096,
    });

    this.discriminator = new DiscriminatorRunner({
      provider,
      model: config.discriminatorModel,
      maxTokens: 2048,
    });

    this.stopConditions = config.stopConditions ?? createDefaultStopConditions();
  }

  /**
   * Execute a workflow
   *
   * @param params - Execution parameters
   * @returns Workflow result
   */
  async execute(params: ExecuteParams): Promise<WorkflowResult> {
    const workflowId = randomUUID();
    const startTime = Date.now();
    const iterations: IterationState[] = [];

    let currentOutput = "";
    let lastFeedback: DiscriminatorFeedback | null = null;
    let stopReason: StopReason = "max_iterations";

    logger.info(
      {
        workflowId,
        task: params.task.slice(0, 100),
        criteriaCount: params.criteria.length,
        maxIterations: params.maxIterations,
        scoreThreshold: params.scoreThreshold,
      },
      "Starting workflow execution"
    );

    try {
      for (let iteration = 1; iteration <= params.maxIterations; iteration++) {
        const iterationStartTime = Date.now();

        logger.debug({ workflowId, iteration }, "Starting iteration");

        // Step 1: Generate
        const generatorResult = await this.generator.run({
          task: params.task,
          previousFeedback: lastFeedback,
          iterationNumber: iteration,
        });
        currentOutput = generatorResult.output;

        // Step 2: Discriminate
        const discriminatorResult = await this.discriminator.run({
          output: currentOutput,
          criteria: params.criteria,
          task: params.task,
        });
        lastFeedback = discriminatorResult.feedback;

        // Record iteration
        const iterationState: IterationState = {
          number: iteration,
          generatorOutput: currentOutput,
          feedback: lastFeedback,
          durationMs: Date.now() - iterationStartTime,
          timestamp: new Date().toISOString(),
          tokensUsed: {
            generator: generatorResult.usage?.inputTokens,
            discriminator: discriminatorResult.usage?.inputTokens,
          },
        };
        iterations.push(iterationState);

        logger.info(
          {
            workflowId,
            iteration,
            score: lastFeedback.score,
            passed: lastFeedback.passed,
            durationMs: iterationState.durationMs,
          },
          "Iteration completed"
        );

        // Step 3: Check stop conditions
        const stopContext: StopConditionContext = {
          currentIteration: iteration,
          maxIterations: params.maxIterations,
          scoreThreshold: params.scoreThreshold,
          iterations,
          currentScore: lastFeedback.score,
          currentPassed: lastFeedback.passed,
        };

        const stopResult = this.stopConditions.evaluate(stopContext);

        if (stopResult.shouldStop) {
          stopReason = stopResult.reason ?? "threshold_reached";

          logger.info(
            {
              workflowId,
              iteration,
              stopReason,
              message: stopResult.message,
            },
            "Stop condition triggered"
          );

          break;
        }
      }

      // Determine success based on stop reason
      const success = stopReason === "threshold_reached";
      const finalScore = lastFeedback?.score ?? 0;

      const result: WorkflowResult = {
        success,
        workflowId,
        output: currentOutput,
        iterations: iterations.length,
        finalScore,
        totalDurationMs: Date.now() - startTime,
        reason: stopReason,
        iterationHistory: iterations,
      };

      logger.info(
        {
          workflowId,
          success,
          iterations: result.iterations,
          finalScore,
          totalDurationMs: result.totalDurationMs,
          reason: stopReason,
        },
        "Workflow completed"
      );

      return result;
    } catch (error) {
      logger.error(
        {
          workflowId,
          error: error instanceof Error ? error.message : String(error),
          iterationsCompleted: iterations.length,
        },
        "Workflow execution failed"
      );

      throw new WorkflowExecutionError(
        workflowId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Enqueue workflow for async execution via BullMQ
   *
   * @param params - Execution parameters
   * @param clientId - Optional client ID for rate limiting
   * @returns Workflow ID (also used as job ID)
   */
  async enqueue(params: ExecuteParams, clientId?: string): Promise<string> {
    const workflowId = randomUUID();
    const queue = getWorkflowQueue();

    await queue.enqueue({
      workflowId,
      task: params.task,
      criteria: params.criteria,
      maxIterations: params.maxIterations,
      scoreThreshold: params.scoreThreshold,
      generatorModel: this.config.generatorModel,
      discriminatorModel: this.config.discriminatorModel,
      providerType: this.config.providerType,
      ...(clientId !== undefined ? { clientId } : {}),
    });

    logger.info({ workflowId, clientId }, "Workflow enqueued to BullMQ");
    return workflowId;
  }
}

/**
 * Create an orchestrator with configuration from environment
 */
export function createOrchestrator(
  generatorModel: string,
  discriminatorModel: string,
  providerType: LLMProviderType = "anthropic"
): RalphOrchestrator {
  return new RalphOrchestrator({
    generatorModel,
    discriminatorModel,
    providerType,
  });
}
