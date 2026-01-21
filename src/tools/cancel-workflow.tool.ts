import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "./index.js";
import { WorkflowNotFoundError } from "../shared/errors/index.js";
import { logger } from "../shared/utils/logger.js";
import { getWorkflowStateStore } from "../infrastructure/persistence/redis/index.js";
import { getWorkflowQueue } from "../infrastructure/queue/index.js";

/**
 * Input schema for cancel_workflow tool
 */
const InputSchema = z.object({
  workflowId: z.string().uuid().describe("The workflow ID to cancel"),
  reason: z.string().optional().describe("Optional reason for cancellation"),
});

/**
 * Cancel workflow tool
 */
export const cancelWorkflowTool: Tool = {
  name: "cancel_workflow",
  description: `Cancel a running workflow.

Gracefully stops the workflow execution:
- Marks the workflow as cancelled
- Stops any pending iterations
- Cleans up resources
- Returns the final state

Parameters:
- workflowId: UUID of the workflow to cancel
- reason: Optional reason for cancellation`,

  inputSchema: zodToJsonSchema(InputSchema, "CancelWorkflowInput") as Record<string, unknown>,

  execute: async (args: unknown) => {
    const parseResult = InputSchema.safeParse(args);
    if (!parseResult.success) {
      throw new Error(`Invalid input: ${parseResult.error.message}`);
    }

    const { workflowId, reason } = parseResult.data;
    const cancelReason = reason ?? "User requested cancellation";

    logger.info({ workflowId, reason: cancelReason }, "Cancelling workflow");

    // Try to find and cancel in Redis state store
    const stateStore = getWorkflowStateStore();
    const state = await stateStore.get(workflowId);

    if (state) {
      // Found in Redis - check if cancellable
      if (state.status === "completed") {
        throw new Error(`Cannot cancel workflow ${workflowId}: already completed`);
      }

      if (state.status === "failed") {
        throw new Error(`Cannot cancel workflow ${workflowId}: already failed`);
      }

      if (state.status === "cancelled") {
        // Already cancelled - return current state
        return {
          workflowId,
          status: "cancelled",
          message: "Workflow was already cancelled",
          cancelledAt: state.updatedAt,
          finalIteration: state.currentIteration,
          finalScore: state.currentScore,
        };
      }

      // Cancel the workflow in Redis
      await stateStore.cancel(workflowId, cancelReason);

      // Also try to cancel in BullMQ queue
      const queue = getWorkflowQueue();
      await queue.cancelJob(workflowId);

      logger.info(
        { workflowId, previousStatus: state.status, reason: cancelReason },
        "Workflow cancelled"
      );

      return {
        workflowId,
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        reason: cancelReason,
        previousStatus: state.status,
        finalIteration: state.currentIteration,
        finalScore: state.currentScore,
      };
    }

    // Not in Redis - check if it's in BullMQ queue
    const queue = getWorkflowQueue();
    const jobStatus = await queue.getJobStatus(workflowId);

    if (jobStatus) {
      // Found in BullMQ queue
      if (jobStatus.state === "completed") {
        throw new Error(`Cannot cancel workflow ${workflowId}: already completed`);
      }

      if (jobStatus.state === "failed") {
        throw new Error(`Cannot cancel workflow ${workflowId}: already failed`);
      }

      // Try to cancel the job
      const cancelled = await queue.cancelJob(workflowId);

      if (cancelled) {
        logger.info(
          { workflowId, queueState: jobStatus.state, reason: cancelReason },
          "Workflow job cancelled in queue"
        );

        return {
          workflowId,
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          reason: cancelReason,
          previousStatus: jobStatus.state === "waiting" ? "pending" : "running",
          finalIteration: jobStatus.progress?.iteration ?? 0,
          finalScore: jobStatus.progress?.currentScore ?? null,
        };
      } else {
        // Could not cancel - might be in a non-cancellable state
        throw new Error(`Cannot cancel workflow ${workflowId} in state: ${jobStatus.state}`);
      }
    }

    // Not found anywhere
    throw new WorkflowNotFoundError(workflowId);
  },
};
