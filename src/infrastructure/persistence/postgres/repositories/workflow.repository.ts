import { eq, desc, and, sql, count } from "drizzle-orm";
import { getPostgresClient } from "../client.js";
import {
  workflows,
  iterations,
  auditLogs,
  type Workflow,
  type NewWorkflow,
  type NewIteration,
  type NewAuditLog,
} from "../schema.js";
import type { WorkflowStatus } from "../../../../shared/types/index.js";
import { logger } from "../../../../shared/utils/logger.js";

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Filter options for listing workflows
 */
export interface WorkflowFilterOptions extends PaginationOptions {
  status?: WorkflowStatus;
  fromDate?: Date;
  toDate?: Date;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Workflow Repository
 *
 * Handles persistence of workflow data to PostgreSQL
 */
export class WorkflowRepository {
  /**
   * Get the database instance
   */
  private getDb() {
    const client = getPostgresClient();
    if (!client.isAvailable()) {
      throw new Error("PostgreSQL not available");
    }
    return client.getDb();
  }

  /**
   * Save a new workflow
   */
  async save(workflow: NewWorkflow): Promise<Workflow> {
    const db = this.getDb();

    const [result] = await db.insert(workflows).values(workflow).returning();

    if (!result) {
      throw new Error("Failed to save workflow");
    }

    logger.debug({ workflowId: result.id }, "Workflow saved to database");

    return result;
  }

  /**
   * Find workflow by ID
   */
  async findById(id: string): Promise<Workflow | null> {
    const db = this.getDb();

    const result = await db.query.workflows.findFirst({
      where: eq(workflows.id, id),
    });

    return result ?? null;
  }

  /**
   * Find workflow by ID with iterations
   */
  async findByIdWithIterations(id: string): Promise<(Workflow & { iterations: typeof iterations.$inferSelect[] }) | null> {
    const db = this.getDb();

    const result = await db.query.workflows.findFirst({
      where: eq(workflows.id, id),
      with: {
        iterations: {
          orderBy: (iterations, { asc }) => [asc(iterations.iterationNumber)],
        },
      },
    });

    return result ?? null;
  }

  /**
   * Find workflows by status
   */
  async findByStatus(status: WorkflowStatus): Promise<Workflow[]> {
    const db = this.getDb();

    const result = await db.query.workflows.findMany({
      where: eq(workflows.status, status),
      orderBy: [desc(workflows.createdAt)],
    });

    return result;
  }

  /**
   * Update a workflow
   */
  async update(
    id: string,
    updates: Partial<Omit<NewWorkflow, "id" | "createdAt">>
  ): Promise<Workflow | null> {
    const db = this.getDb();

    const [result] = await db
      .update(workflows)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, id))
      .returning();

    if (result) {
      logger.debug({ workflowId: id }, "Workflow updated in database");
    }

    return result ?? null;
  }

  /**
   * Mark workflow as completed
   */
  async complete(
    id: string,
    output: string,
    score: number,
    totalIterations: number,
    stopReason: string,
    durationMs: number,
    tokensUsed?: number,
    costUsd?: number
  ): Promise<Workflow | null> {
    return this.update(id, {
      status: "completed",
      finalOutput: output,
      finalScore: score,
      totalIterations,
      stopReason,
      totalDurationMs: durationMs,
      completedAt: new Date(),
      ...(tokensUsed !== undefined ? { totalTokensUsed: tokensUsed } : {}),
      ...(costUsd !== undefined ? { estimatedCostUsd: costUsd } : {}),
    });
  }

  /**
   * Mark workflow as failed
   */
  async fail(id: string, errorMessage: string): Promise<Workflow | null> {
    return this.update(id, {
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    });
  }

  /**
   * Mark workflow as cancelled
   */
  async cancel(id: string, reason?: string): Promise<Workflow | null> {
    return this.update(id, {
      status: "cancelled",
      stopReason: reason ?? "User cancelled",
      completedAt: new Date(),
    });
  }

  /**
   * List workflows with pagination and filters
   */
  async list(options: WorkflowFilterOptions = {}): Promise<PaginatedResult<Workflow>> {
    const db = this.getDb();
    const { limit = 20, offset = 0, status, fromDate, toDate } = options;

    // Build conditions
    const conditions = [];
    if (status) {
      conditions.push(eq(workflows.status, status));
    }
    if (fromDate) {
      conditions.push(sql`${workflows.createdAt} >= ${fromDate}`);
    }
    if (toDate) {
      conditions.push(sql`${workflows.createdAt} <= ${toDate}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [countResult] = await db
      .select({ count: count() })
      .from(workflows)
      .where(whereClause);
    const total = countResult?.count ?? 0;

    // Get data
    const data = await db
      .select()
      .from(workflows)
      .where(whereClause)
      .orderBy(desc(workflows.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Delete a workflow and its iterations
   */
  async delete(id: string): Promise<boolean> {
    const db = this.getDb();

    const result = await db.delete(workflows).where(eq(workflows.id, id)).returning();

    if (result.length > 0) {
      logger.debug({ workflowId: id }, "Workflow deleted from database");
      return true;
    }

    return false;
  }

  /**
   * Add an iteration to a workflow
   */
  async addIteration(iteration: NewIteration): Promise<typeof iterations.$inferSelect> {
    const db = this.getDb();

    const [result] = await db.insert(iterations).values(iteration).returning();

    if (!result) {
      throw new Error("Failed to save iteration");
    }

    logger.debug(
      { workflowId: iteration.workflowId, iterationNumber: iteration.iterationNumber },
      "Iteration saved to database"
    );

    return result;
  }

  /**
   * Get iterations for a workflow
   */
  async getIterations(workflowId: string): Promise<typeof iterations.$inferSelect[]> {
    const db = this.getDb();

    const result = await db
      .select()
      .from(iterations)
      .where(eq(iterations.workflowId, workflowId))
      .orderBy(iterations.iterationNumber);

    return result;
  }

  /**
   * Add audit log entry
   */
  async addAuditLog(log: NewAuditLog): Promise<typeof auditLogs.$inferSelect> {
    const db = this.getDb();

    const [result] = await db.insert(auditLogs).values(log).returning();

    if (!result) {
      throw new Error("Failed to save audit log");
    }

    return result;
  }

  /**
   * Get audit logs for a workflow
   */
  async getAuditLogs(workflowId: string): Promise<typeof auditLogs.$inferSelect[]> {
    const db = this.getDb();

    const result = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.workflowId, workflowId))
      .orderBy(desc(auditLogs.createdAt));

    return result;
  }

  /**
   * Get workflow statistics
   */
  async getStatistics(fromDate?: Date, toDate?: Date): Promise<{
    total: number;
    byStatus: Record<string, number>;
    avgIterations: number;
    avgDurationMs: number;
    avgScore: number;
  }> {
    const db = this.getDb();

    const conditions = [];
    if (fromDate) {
      conditions.push(sql`${workflows.createdAt} >= ${fromDate}`);
    }
    if (toDate) {
      conditions.push(sql`${workflows.createdAt} <= ${toDate}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get counts by status
    const statusCounts = await db
      .select({
        status: workflows.status,
        count: count(),
      })
      .from(workflows)
      .where(whereClause)
      .groupBy(workflows.status);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of statusCounts) {
      byStatus[row.status] = row.count;
      total += row.count;
    }

    // Get averages for completed workflows
    const [avgResult] = await db
      .select({
        avgIterations: sql<number>`AVG(${workflows.totalIterations})`,
        avgDurationMs: sql<number>`AVG(${workflows.totalDurationMs})`,
        avgScore: sql<number>`AVG(${workflows.finalScore})`,
      })
      .from(workflows)
      .where(and(eq(workflows.status, "completed"), whereClause));

    return {
      total,
      byStatus,
      avgIterations: avgResult?.avgIterations ?? 0,
      avgDurationMs: avgResult?.avgDurationMs ?? 0,
      avgScore: avgResult?.avgScore ?? 0,
    };
  }
}

// Singleton instance
let workflowRepository: WorkflowRepository | null = null;

/**
 * Get or create the workflow repository singleton
 */
export function getWorkflowRepository(): WorkflowRepository {
  if (!workflowRepository) {
    workflowRepository = new WorkflowRepository();
  }
  return workflowRepository;
}

/**
 * Reset the repository (for testing)
 */
export function resetWorkflowRepository(): void {
  workflowRepository = null;
}
