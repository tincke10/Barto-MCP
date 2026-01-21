import { getRedisClient, type ResilientRedisClient } from "./client.js";
import type { WorkflowStatus } from "../../../shared/types/index.js";
import type { IterationState, DiscriminatorFeedback } from "../../../schemas/workflow.schema.js";
import { logger } from "../../../shared/utils/logger.js";

/**
 * Workflow state stored in Redis
 */
export interface WorkflowState {
  /** Unique workflow ID */
  id: string;
  /** Current status */
  status: WorkflowStatus;
  /** Task description */
  task: string;
  /** Evaluation criteria */
  criteria: string[];
  /** Current iteration number */
  currentIteration: number;
  /** Maximum iterations allowed */
  maxIterations: number;
  /** Score threshold for success */
  scoreThreshold: number;
  /** Current output (latest) */
  currentOutput?: string;
  /** Latest feedback */
  lastFeedback?: DiscriminatorFeedback;
  /** Current score */
  currentScore?: number;
  /** Iteration history */
  iterations: IterationState[];
  /** Workflow start time */
  startedAt: string;
  /** Last update time */
  updatedAt: string;
  /** Completion time */
  completedAt?: string;
  /** Stop reason if completed */
  stopReason?: string;
  /** Error message if failed */
  errorMessage?: string;
  /** Generator model */
  generatorModel?: string;
  /** Discriminator model */
  discriminatorModel?: string;
}

/**
 * Options for workflow state store
 */
export interface WorkflowStateStoreOptions {
  /** TTL for workflow states in seconds (default: 24 hours) */
  ttlSeconds?: number;
  /** Key prefix for workflow states */
  keyPrefix?: string;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const DEFAULT_KEY_PREFIX = "workflow:state:";

/**
 * Workflow State Store
 *
 * Manages workflow state persistence in Redis with automatic TTL
 * for cleanup of old workflow states.
 */
export class WorkflowStateStore {
  private redis: ResilientRedisClient;
  private ttlSeconds: number;
  private keyPrefix: string;

  constructor(options: WorkflowStateStoreOptions = {}) {
    this.redis = getRedisClient();
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  }

  /**
   * Get the Redis key for a workflow
   */
  private getKey(workflowId: string): string {
    return `${this.keyPrefix}${workflowId}`;
  }

  /**
   * Save a new workflow state
   */
  async save(state: WorkflowState): Promise<void> {
    const key = this.getKey(state.id);
    const serialized = JSON.stringify(state);

    await this.redis.set(key, serialized, this.ttlSeconds);

    logger.debug(
      { workflowId: state.id, status: state.status },
      "Workflow state saved"
    );
  }

  /**
   * Get a workflow state by ID
   */
  async get(workflowId: string): Promise<WorkflowState | null> {
    const key = this.getKey(workflowId);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as WorkflowState;
    } catch (error) {
      logger.error(
        { workflowId, error: error instanceof Error ? error.message : String(error) },
        "Failed to parse workflow state"
      );
      return null;
    }
  }

  /**
   * Update an existing workflow state
   */
  async update(
    workflowId: string,
    updates: Partial<Omit<WorkflowState, "id">>
  ): Promise<WorkflowState | null> {
    const current = await this.get(workflowId);

    if (!current) {
      logger.warn({ workflowId }, "Workflow not found for update");
      return null;
    }

    const updated: WorkflowState = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.save(updated);

    logger.debug(
      { workflowId, status: updated.status, iteration: updated.currentIteration },
      "Workflow state updated"
    );

    return updated;
  }

  /**
   * Update workflow with new iteration
   */
  async addIteration(
    workflowId: string,
    iteration: IterationState
  ): Promise<WorkflowState | null> {
    const current = await this.get(workflowId);

    if (!current) {
      logger.warn({ workflowId }, "Workflow not found for iteration update");
      return null;
    }

    const updated: WorkflowState = {
      ...current,
      currentIteration: iteration.number,
      currentOutput: iteration.generatorOutput,
      lastFeedback: iteration.feedback,
      currentScore: iteration.feedback.score,
      iterations: [...current.iterations, iteration],
      updatedAt: new Date().toISOString(),
    };

    await this.save(updated);

    logger.debug(
      {
        workflowId,
        iteration: iteration.number,
        score: iteration.feedback.score,
      },
      "Workflow iteration added"
    );

    return updated;
  }

  /**
   * Mark workflow as completed
   */
  async complete(
    workflowId: string,
    output: string,
    stopReason: string,
    finalScore: number
  ): Promise<WorkflowState | null> {
    return this.update(workflowId, {
      status: "completed",
      currentOutput: output,
      currentScore: finalScore,
      stopReason,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Mark workflow as failed
   */
  async fail(workflowId: string, errorMessage: string): Promise<WorkflowState | null> {
    return this.update(workflowId, {
      status: "failed",
      errorMessage,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Mark workflow as cancelled
   */
  async cancel(workflowId: string, reason?: string): Promise<WorkflowState | null> {
    return this.update(workflowId, {
      status: "cancelled",
      stopReason: reason ?? "User cancelled",
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Delete a workflow state
   */
  async delete(workflowId: string): Promise<boolean> {
    const key = this.getKey(workflowId);
    const deleted = await this.redis.del(key);

    if (deleted > 0) {
      logger.debug({ workflowId }, "Workflow state deleted");
      return true;
    }

    return false;
  }

  /**
   * Check if a workflow exists
   */
  async exists(workflowId: string): Promise<boolean> {
    const key = this.getKey(workflowId);
    return this.redis.exists(key);
  }

  /**
   * List all workflow IDs (with optional status filter)
   */
  async listIds(status?: WorkflowStatus): Promise<string[]> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.redis.keys(pattern);

    const ids = keys.map((key) => key.replace(this.keyPrefix, ""));

    if (!status) {
      return ids;
    }

    // Filter by status (requires fetching each state)
    const filtered: string[] = [];
    for (const id of ids) {
      const state = await this.get(id);
      if (state && state.status === status) {
        filtered.push(id);
      }
    }

    return filtered;
  }

  /**
   * List workflows with pagination
   */
  async list(options: {
    status?: WorkflowStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ workflows: WorkflowState[]; total: number }> {
    const { status, limit = 20, offset = 0 } = options;

    const ids = await this.listIds(status);
    const total = ids.length;

    // Apply pagination
    const paginatedIds = ids.slice(offset, offset + limit);

    // Fetch states
    const workflows: WorkflowState[] = [];
    for (const id of paginatedIds) {
      const state = await this.get(id);
      if (state) {
        workflows.push(state);
      }
    }

    // Sort by updatedAt descending
    workflows.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return { workflows, total };
  }

  /**
   * Get workflows by status
   */
  async getByStatus(status: WorkflowStatus): Promise<WorkflowState[]> {
    const { workflows } = await this.list({ status });
    return workflows;
  }

  /**
   * Get running workflows count
   */
  async getRunningCount(): Promise<number> {
    const running = await this.listIds("running");
    return running.length;
  }

  /**
   * Create initial workflow state
   */
  static createInitialState(params: {
    id: string;
    task: string;
    criteria: string[];
    maxIterations: number;
    scoreThreshold: number;
    generatorModel?: string;
    discriminatorModel?: string;
  }): WorkflowState {
    const now = new Date().toISOString();
    return {
      id: params.id,
      status: "pending",
      task: params.task,
      criteria: params.criteria,
      currentIteration: 0,
      maxIterations: params.maxIterations,
      scoreThreshold: params.scoreThreshold,
      iterations: [],
      startedAt: now,
      updatedAt: now,
      ...(params.generatorModel ? { generatorModel: params.generatorModel } : {}),
      ...(params.discriminatorModel ? { discriminatorModel: params.discriminatorModel } : {}),
    };
  }
}

// Singleton instance
let stateStore: WorkflowStateStore | null = null;

/**
 * Get or create the workflow state store singleton
 */
export function getWorkflowStateStore(options?: WorkflowStateStoreOptions): WorkflowStateStore {
  if (!stateStore) {
    stateStore = new WorkflowStateStore(options);
  }
  return stateStore;
}

/**
 * Reset the state store (for testing)
 */
export function resetWorkflowStateStore(): void {
  stateStore = null;
}
