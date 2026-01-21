import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "./index.js";
import { WorkflowNotFoundError } from "../shared/errors/index.js";
import { logger } from "../shared/utils/logger.js";
import { getWorkflowStateStore } from "../infrastructure/persistence/redis/index.js";
import { getWorkflowQueue } from "../infrastructure/queue/index.js";

/**
 * Input schema for get_status tool
 */
const InputSchema = z.object({
  workflowId: z.string().uuid().describe("The workflow ID to check"),
  includeHistory: z
    .boolean()
    .default(false)
    .describe("Include full iteration history"),
});

/**
 * Get workflow status tool
 */
export const getStatusTool: Tool = {
  name: "get_status",
  description: `Get the current status of a workflow.

Returns the workflow state including:
- Current status (pending, running, completed, failed, cancelled)
- Current iteration number
- Current score
- Optional: Full iteration history

Parameters:
- workflowId: UUID of the workflow
- includeHistory: Whether to include full iteration history (default: false)`,

  inputSchema: zodToJsonSchema(InputSchema, "GetStatusInput") as Record<string, unknown>,

  execute: async (args: unknown) => {
    const parseResult = InputSchema.safeParse(args);
    if (!parseResult.success) {
      throw new Error(`Invalid input: ${parseResult.error.message}`);
    }

    const { workflowId, includeHistory } = parseResult.data;

    logger.debug({ workflowId, includeHistory }, "Getting workflow status");

    // Try to get state from Redis first
    const stateStore = getWorkflowStateStore();
    const state = await stateStore.get(workflowId);

    if (state) {
      // Found in Redis - workflow is active or recently completed
      const response: Record<string, unknown> = {
        workflowId: state.id,
        status: state.status,
        currentIteration: state.currentIteration,
        maxIterations: state.maxIterations,
        currentScore: state.currentScore ?? null,
        scoreThreshold: state.scoreThreshold,
        startedAt: state.startedAt,
        lastUpdated: state.updatedAt,
      };

      // Add output if completed
      if (state.status === "completed" && state.currentOutput) {
        response.output = state.currentOutput;
        if (state.stopReason) {
          response.stopReason = state.stopReason;
        }
      }

      // Add error if failed
      if (state.status === "failed" && state.errorMessage) {
        response.error = state.errorMessage;
      }

      // Include iteration history if requested
      if (includeHistory && state.iterations.length > 0) {
        response.iterations = state.iterations.map((iter) => ({
          number: iter.number,
          score: iter.feedback.score,
          passed: iter.feedback.passed,
          durationMs: iter.durationMs,
        }));
      }

      return response;
    }

    // Not in Redis - check if it's queued in BullMQ
    const queue = getWorkflowQueue();
    const jobStatus = await queue.getJobStatus(workflowId);

    if (jobStatus) {
      // Found in BullMQ queue
      const response: Record<string, unknown> = {
        workflowId,
        status: mapQueueStateToWorkflowStatus(jobStatus.state),
        queueState: jobStatus.state,
      };

      // Add progress if available
      if (jobStatus.progress) {
        response.currentIteration = jobStatus.progress.iteration;
        response.maxIterations = jobStatus.progress.maxIterations;
        if (jobStatus.progress.currentScore !== undefined) {
          response.currentScore = jobStatus.progress.currentScore;
        }
      }

      // Add result if completed
      if (jobStatus.result) {
        const result: Record<string, unknown> = {
          success: jobStatus.result.success,
          iterations: jobStatus.result.iterations,
          reason: jobStatus.result.reason,
          durationMs: jobStatus.result.durationMs,
        };
        if (jobStatus.result.output !== undefined) {
          result.output = jobStatus.result.output;
        }
        if (jobStatus.result.finalScore !== undefined) {
          result.finalScore = jobStatus.result.finalScore;
        }
        response.result = result;
      }

      // Add failure reason if failed
      if (jobStatus.failedReason) {
        response.failedReason = jobStatus.failedReason;
      }

      return response;
    }

    // Not found anywhere
    throw new WorkflowNotFoundError(workflowId);
  },
};

/**
 * Map BullMQ job state to workflow status
 */
function mapQueueStateToWorkflowStatus(state: string): string {
  switch (state) {
    case "waiting":
    case "delayed":
      return "pending";
    case "active":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return state;
  }
}
