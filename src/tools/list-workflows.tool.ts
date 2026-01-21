import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "./index.js";
import { logger } from "../shared/utils/logger.js";
import type { WorkflowStatus } from "../shared/types/index.js";
import { getWorkflowRepository } from "../infrastructure/persistence/postgres/index.js";
import { getPostgresClient } from "../infrastructure/persistence/postgres/index.js";
import { getWorkflowStateStore } from "../infrastructure/persistence/redis/index.js";

/**
 * Input schema for list_workflows tool
 */
const InputSchema = z.object({
  status: z
    .enum(["pending", "running", "completed", "failed", "cancelled", "all"])
    .default("all")
    .describe("Filter by workflow status"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of results"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip"),
  sortBy: z
    .enum(["createdAt", "updatedAt", "score"])
    .default("createdAt")
    .describe("Field to sort by"),
  sortOrder: z
    .enum(["asc", "desc"])
    .default("desc")
    .describe("Sort order"),
});

/**
 * List workflows tool
 */
export const listWorkflowsTool: Tool = {
  name: "list_workflows",
  description: `List workflows with optional filtering and pagination.

Returns a list of workflows with summary information:
- Workflow ID
- Status
- Task summary
- Iterations count
- Final score
- Timestamps

Parameters:
- status: Filter by status ('pending', 'running', 'completed', 'failed', 'cancelled', 'all')
- limit: Max results (1-100, default: 20)
- offset: Results to skip (default: 0)
- sortBy: Sort field ('createdAt', 'updatedAt', 'score')
- sortOrder: Sort direction ('asc', 'desc')`,

  inputSchema: zodToJsonSchema(InputSchema, "ListWorkflowsInput") as Record<string, unknown>,

  execute: async (args: unknown) => {
    const parseResult = InputSchema.safeParse(args);
    if (!parseResult.success) {
      throw new Error(`Invalid input: ${parseResult.error.message}`);
    }

    const { status, limit, offset, sortBy, sortOrder } = parseResult.data;

    logger.debug({ status, limit, offset, sortBy, sortOrder }, "Listing workflows");

    // Check if PostgreSQL is available
    const postgresClient = getPostgresClient();

    if (postgresClient.isAvailable()) {
      // Use PostgreSQL for historical data
      const repository = getWorkflowRepository();

      const filterOptions: { status?: WorkflowStatus; limit: number; offset: number } = {
        limit,
        offset,
      };
      if (status !== "all") {
        filterOptions.status = status as WorkflowStatus;
      }

      const result = await repository.list(filterOptions);

      let workflows = result.data.map((w) => ({
        id: w.id,
        status: w.status,
        taskSummary: w.task.slice(0, 100) + (w.task.length > 100 ? "..." : ""),
        criteriaCount: w.criteria.length,
        iterations: w.totalIterations ?? 0,
        finalScore: w.finalScore ?? null,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
        durationMs: w.totalDurationMs ?? null,
      }));

      // Apply client-side sorting if needed
      if (sortBy !== "createdAt" || sortOrder !== "desc") {
        workflows = sortWorkflows(workflows, sortBy, sortOrder);
      }

      return {
        workflows,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.hasMore,
        },
        filters: {
          status,
          sortBy,
          sortOrder,
        },
        source: "postgres",
      };
    }

    // Fallback to Redis for active workflows
    logger.debug("PostgreSQL not available, falling back to Redis");

    const stateStore = getWorkflowStateStore();
    const listOptions: { status?: WorkflowStatus; limit: number; offset: number } = {
      limit,
      offset,
    };
    if (status !== "all") {
      listOptions.status = status as WorkflowStatus;
    }

    const result = await stateStore.list(listOptions);

    const workflows = result.workflows.map((w) => ({
      id: w.id,
      status: w.status,
      taskSummary: w.task.slice(0, 100) + (w.task.length > 100 ? "..." : ""),
      criteriaCount: w.criteria.length,
      iterations: w.currentIteration,
      currentScore: w.currentScore ?? null,
      createdAt: w.startedAt,
      updatedAt: w.updatedAt,
    }));

    // Sort based on parameters
    workflows.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "createdAt") {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortBy === "updatedAt") {
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      } else if (sortBy === "score") {
        comparison = (a.currentScore ?? 0) - (b.currentScore ?? 0);
      }
      return sortOrder === "desc" ? -comparison : comparison;
    });

    return {
      workflows,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < result.total,
      },
      filters: {
        status,
        sortBy,
        sortOrder,
      },
      source: "redis",
    };
  },
};

/**
 * Sort workflows by the specified field and order
 */
function sortWorkflows<T extends { createdAt: string; updatedAt: string; finalScore?: number | null; currentScore?: number | null }>(
  workflows: T[],
  sortBy: "createdAt" | "updatedAt" | "score",
  sortOrder: "asc" | "desc"
): T[] {
  return [...workflows].sort((a, b) => {
    let comparison = 0;
    if (sortBy === "createdAt") {
      comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (sortBy === "updatedAt") {
      comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    } else if (sortBy === "score") {
      const scoreA = a.finalScore ?? a.currentScore ?? 0;
      const scoreB = b.finalScore ?? b.currentScore ?? 0;
      comparison = scoreA - scoreB;
    }
    return sortOrder === "desc" ? -comparison : comparison;
  });
}
