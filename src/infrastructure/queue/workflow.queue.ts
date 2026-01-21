import type { Job } from "bullmq";
import { getQueueManager, QUEUE_NAMES } from "./client.js";
import type { WorkflowStatus } from "../../shared/types/index.js";
import { logger } from "../../shared/utils/logger.js";

/**
 * Workflow job data
 */
export interface WorkflowJobData {
  /** Workflow ID */
  workflowId: string;
  /** Task description */
  task: string;
  /** Evaluation criteria */
  criteria: string[];
  /** Maximum iterations */
  maxIterations: number;
  /** Score threshold for success */
  scoreThreshold: number;
  /** Generator model */
  generatorModel: string;
  /** Discriminator model */
  discriminatorModel: string;
  /** LLM provider type */
  providerType: "anthropic" | "openai";
  /** Client ID for rate limiting */
  clientId?: string;
  /** Priority (higher = more important) */
  priority?: number;
}

/**
 * Workflow job result
 */
export interface WorkflowJobResult {
  /** Whether workflow succeeded */
  success: boolean;
  /** Workflow ID */
  workflowId: string;
  /** Final output */
  output?: string;
  /** Final score */
  finalScore?: number;
  /** Total iterations */
  iterations: number;
  /** Stop reason */
  reason: string;
  /** Total duration in ms */
  durationMs: number;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Job progress data
 */
export interface WorkflowJobProgress {
  /** Current iteration */
  iteration: number;
  /** Max iterations */
  maxIterations: number;
  /** Current score */
  currentScore?: number;
  /** Current status */
  status: WorkflowStatus;
}

/**
 * Workflow Queue
 *
 * Manages the workflow execution queue with BullMQ
 */
export class WorkflowQueue {
  private queueName = QUEUE_NAMES.WORKFLOW;

  /**
   * Add a workflow job to the queue
   */
  async enqueue(
    data: WorkflowJobData,
    options: {
      delay?: number;
      priority?: number;
      jobId?: string;
    } = {}
  ): Promise<string> {
    const queueManager = getQueueManager();
    const queue = queueManager.getQueue(this.queueName);

    const jobOptions: {
      jobId: string;
      delay?: number;
      priority?: number;
    } = {
      jobId: options.jobId ?? data.workflowId,
    };

    if (options.delay !== undefined) {
      jobOptions.delay = options.delay;
    }

    const priority = options.priority ?? data.priority;
    if (priority !== undefined) {
      jobOptions.priority = priority;
    }

    const job = await queue.add("execute-workflow", data, jobOptions);

    logger.info(
      {
        jobId: job.id,
        workflowId: data.workflowId,
        priority: options.priority ?? data.priority,
      },
      "Workflow job enqueued"
    );

    return job.id!;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job<WorkflowJobData, WorkflowJobResult> | null> {
    const queueManager = getQueueManager();
    const queue = queueManager.getQueue(this.queueName);
    const job = await queue.getJob(jobId);
    return job as Job<WorkflowJobData, WorkflowJobResult> | null;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<{
    state: string;
    progress?: WorkflowJobProgress;
    result?: WorkflowJobResult;
    failedReason?: string;
  } | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress as WorkflowJobProgress | undefined;
    const result = job.returnvalue as WorkflowJobResult | undefined;

    const status: {
      state: string;
      progress?: WorkflowJobProgress;
      result?: WorkflowJobResult;
      failedReason?: string;
    } = { state };

    if (progress) {
      status.progress = progress;
    }
    if (result) {
      status.result = result;
    }
    if (job.failedReason) {
      status.failedReason = job.failedReason;
    }

    return status;
  }

  /**
   * Cancel a job (remove from queue if waiting)
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) return false;

    const state = await job.getState();

    if (state === "waiting" || state === "delayed") {
      await job.remove();
      logger.info({ jobId }, "Job removed from queue");
      return true;
    }

    if (state === "active") {
      // Can't directly cancel active jobs, but we can mark for cancellation
      // The worker should check for this
      await job.updateProgress({
        ...(job.progress as object),
        cancelled: true,
      });
      logger.info({ jobId }, "Job marked for cancellation");
      return true;
    }

    return false;
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queueManager = getQueueManager();
    return queueManager.getQueueStats(this.queueName);
  }

  /**
   * Get jobs by state
   */
  async getJobs(
    state: "waiting" | "active" | "completed" | "failed" | "delayed",
    start = 0,
    end = 20
  ): Promise<Job<WorkflowJobData, WorkflowJobResult>[]> {
    const queueManager = getQueueManager();
    const queue = queueManager.getQueue(this.queueName);
    const jobs = await queue.getJobs([state], start, end);
    return jobs as Job<WorkflowJobData, WorkflowJobResult>[];
  }

  /**
   * Drain the queue (remove all jobs)
   */
  async drain(): Promise<void> {
    const queueManager = getQueueManager();
    const queue = queueManager.getQueue(this.queueName);
    await queue.drain();
    logger.info({ queueName: this.queueName }, "Queue drained");
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    const queueManager = getQueueManager();
    const queue = queueManager.getQueue(this.queueName);
    await queue.pause();
    logger.info({ queueName: this.queueName }, "Queue paused");
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    const queueManager = getQueueManager();
    const queue = queueManager.getQueue(this.queueName);
    await queue.resume();
    logger.info({ queueName: this.queueName }, "Queue resumed");
  }
}

// Singleton instance
let workflowQueue: WorkflowQueue | null = null;

/**
 * Get or create the workflow queue singleton
 */
export function getWorkflowQueue(): WorkflowQueue {
  if (!workflowQueue) {
    workflowQueue = new WorkflowQueue();
  }
  return workflowQueue;
}

/**
 * Reset the workflow queue (for testing)
 */
export function resetWorkflowQueue(): void {
  workflowQueue = null;
}
