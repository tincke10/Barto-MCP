import type { Job, Worker } from "bullmq";
import { getQueueManager, QUEUE_NAMES } from "../client.js";
import type {
  WorkflowJobData,
  WorkflowJobResult,
  WorkflowJobProgress,
} from "../workflow.queue.js";
import { createOrchestrator } from "../../../core/orchestrator/ralph.orchestrator.js";
import { getWorkflowStateStore, WorkflowStateStore } from "../../persistence/redis/workflow-state.store.js";
import { getWorkflowRepository } from "../../persistence/postgres/repositories/workflow.repository.js";
import { getPostgresClient } from "../../persistence/postgres/client.js";
import { logger } from "../../../shared/utils/logger.js";

/**
 * Configuration for the workflow worker
 */
export interface WorkflowWorkerConfig {
  /** Number of concurrent jobs */
  concurrency?: number;
  /** Rate limiter configuration */
  limiter?: {
    /** Max jobs in duration */
    max: number;
    /** Duration in ms */
    duration: number;
  };
}

/**
 * Create and start the workflow worker
 */
export function createWorkflowWorker(
  config: WorkflowWorkerConfig = {}
): Worker<WorkflowJobData, WorkflowJobResult> {
  const queueManager = getQueueManager();

  const worker = queueManager.createWorker<WorkflowJobData, WorkflowJobResult>(
    QUEUE_NAMES.WORKFLOW,
    async (job) => processWorkflowJob(job as Job<WorkflowJobData, WorkflowJobResult>),
    {
      concurrency: config.concurrency ?? 2,
      limiter: config.limiter ?? {
        max: 10,
        duration: 60000, // 10 jobs per minute
      },
    }
  );

  logger.info(
    { concurrency: config.concurrency ?? 2 },
    "Workflow worker started"
  );

  return worker;
}

/**
 * Process a workflow job
 */
async function processWorkflowJob(
  job: Job<WorkflowJobData, WorkflowJobResult>
): Promise<WorkflowJobResult> {
  const { data } = job;
  const startTime = Date.now();

  logger.info(
    {
      jobId: job.id,
      workflowId: data.workflowId,
      task: data.task.slice(0, 100),
    },
    "Processing workflow job"
  );

  const stateStore = getWorkflowStateStore();

  try {
    // Initialize state in Redis
    const initialState = WorkflowStateStore.createInitialState({
      id: data.workflowId,
      task: data.task,
      criteria: data.criteria,
      maxIterations: data.maxIterations,
      scoreThreshold: data.scoreThreshold,
      generatorModel: data.generatorModel,
      discriminatorModel: data.discriminatorModel,
    });

    initialState.status = "running";
    await stateStore.save(initialState);

    // Update job progress
    await job.updateProgress({
      iteration: 0,
      maxIterations: data.maxIterations,
      status: "running",
    } as WorkflowJobProgress);

    // Create orchestrator
    const orchestrator = createOrchestrator(
      data.generatorModel,
      data.discriminatorModel,
      data.providerType
    );

    // Execute workflow
    const result = await orchestrator.execute({
      task: data.task,
      criteria: data.criteria,
      maxIterations: data.maxIterations,
      scoreThreshold: data.scoreThreshold,
    });

    const durationMs = Date.now() - startTime;

    const reason = result.reason ?? "unknown";

    // Update Redis state
    await stateStore.complete(
      data.workflowId,
      result.output,
      reason,
      result.finalScore
    );

    // Persist to PostgreSQL if available
    const iterationHistory = result.iterationHistory?.map(it => ({
      number: it.number,
      generatorOutput: it.generatorOutput,
      feedback: {
        score: it.feedback.score,
        passed: it.feedback.passed,
        issues: it.feedback.issues,
        suggestions: it.feedback.suggestions,
        reasoning: it.feedback.reasoning ?? "",
      },
      durationMs: it.durationMs,
      timestamp: it.timestamp,
    }));

    const persistResult: {
      success: boolean;
      output: string;
      finalScore: number;
      iterations: number;
      reason: string;
      iterationHistory?: Array<{
        number: number;
        generatorOutput: string;
        feedback: {
          score: number;
          passed: boolean;
          issues: string[];
          suggestions: string;
          reasoning: string;
        };
        durationMs: number;
        timestamp: string;
      }>;
    } = {
      success: result.success,
      output: result.output,
      finalScore: result.finalScore,
      iterations: result.iterations,
      reason,
    };

    if (iterationHistory) {
      persistResult.iterationHistory = iterationHistory;
    }

    await persistToPostgres(data, persistResult, durationMs);

    const jobResult: WorkflowJobResult = {
      success: result.success,
      workflowId: data.workflowId,
      output: result.output,
      finalScore: result.finalScore,
      iterations: result.iterations,
      reason,
      durationMs,
    };

    logger.info(
      {
        jobId: job.id,
        workflowId: data.workflowId,
        success: result.success,
        iterations: result.iterations,
        finalScore: result.finalScore,
        durationMs,
      },
      "Workflow job completed"
    );

    return jobResult;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update Redis state
    await stateStore.fail(data.workflowId, errorMessage);

    logger.error(
      {
        jobId: job.id,
        workflowId: data.workflowId,
        error: errorMessage,
        durationMs,
      },
      "Workflow job failed"
    );

    // Re-throw to let BullMQ handle retries
    throw error;
  }
}

/**
 * Persist workflow result to PostgreSQL
 */
async function persistToPostgres(
  data: WorkflowJobData,
  result: {
    success: boolean;
    output: string;
    finalScore: number;
    iterations: number;
    reason: string;
    iterationHistory?: Array<{
      number: number;
      generatorOutput: string;
      feedback: {
        score: number;
        passed: boolean;
        issues: string[];
        suggestions: string;
        reasoning: string;
      };
      durationMs: number;
      timestamp: string;
    }>;
  },
  durationMs: number
): Promise<void> {
  const postgresClient = getPostgresClient();

  if (!postgresClient.isAvailable()) {
    logger.debug("PostgreSQL not available, skipping persistence");
    return;
  }

  try {
    const repository = getWorkflowRepository();

    // Save workflow
    const workflow = await repository.save({
      id: data.workflowId,
      status: result.success ? "completed" : "failed",
      task: data.task,
      criteria: data.criteria,
      maxIterations: data.maxIterations,
      scoreThreshold: data.scoreThreshold,
      finalOutput: result.output,
      finalScore: result.finalScore,
      totalIterations: result.iterations,
      stopReason: result.reason,
      generatorModel: data.generatorModel,
      discriminatorModel: data.discriminatorModel,
      totalDurationMs: durationMs,
      completedAt: new Date(),
    });

    // Save iterations if available
    if (result.iterationHistory) {
      for (const iteration of result.iterationHistory) {
        await repository.addIteration({
          workflowId: workflow.id,
          iterationNumber: iteration.number,
          generatorOutput: iteration.generatorOutput,
          score: iteration.feedback.score,
          passed: iteration.feedback.passed ? 1 : 0,
          feedback: iteration.feedback,
          durationMs: iteration.durationMs,
        });
      }
    }

    // Add audit log
    await repository.addAuditLog({
      workflowId: workflow.id,
      action: result.success ? "workflow_completed" : "workflow_failed",
      details: {
        iterations: result.iterations,
        finalScore: result.finalScore,
        reason: result.reason,
        durationMs,
      },
      clientId: data.clientId ?? null,
    });

    logger.debug(
      { workflowId: data.workflowId },
      "Workflow persisted to PostgreSQL"
    );
  } catch (error) {
    logger.error(
      {
        workflowId: data.workflowId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to persist workflow to PostgreSQL"
    );
    // Don't throw - PostgreSQL persistence is optional
  }
}

/**
 * Check if a job should be cancelled
 */
export function shouldCancelJob(job: Job<WorkflowJobData, WorkflowJobResult>): boolean {
  const progress = job.progress as WorkflowJobProgress & { cancelled?: boolean };
  return progress?.cancelled === true;
}
