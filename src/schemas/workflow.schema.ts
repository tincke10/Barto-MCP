import { z } from "zod";

/**
 * Feedback from the discriminator after evaluating generated content
 */
export const DiscriminatorFeedbackSchema = z.object({
  passed: z.boolean().describe("Whether the content passed evaluation"),
  score: z.number().min(0).max(1).describe("Quality score from 0 to 1"),
  issues: z.array(z.string()).describe("List of identified issues"),
  suggestions: z.string().describe("Concrete suggestions for improvement"),
  reasoning: z.string().optional().describe("Explanation of the evaluation"),
});

export type DiscriminatorFeedback = z.infer<typeof DiscriminatorFeedbackSchema>;

/**
 * State of a single iteration in the workflow loop
 */
export const IterationStateSchema = z.object({
  number: z.number().int().positive().describe("Iteration number (1-based)"),
  generatorOutput: z.string().describe("Output produced by the generator"),
  feedback: DiscriminatorFeedbackSchema.describe("Feedback from discriminator"),
  durationMs: z.number().describe("Duration of iteration in milliseconds"),
  timestamp: z.string().datetime().describe("ISO timestamp when iteration completed"),
  tokensUsed: z
    .object({
      generator: z.number().int().optional(),
      discriminator: z.number().int().optional(),
    })
    .optional()
    .describe("Token usage for this iteration"),
});

export type IterationState = z.infer<typeof IterationStateSchema>;

/**
 * Complete workflow state
 */
export const WorkflowStateSchema = z.object({
  id: z.string().uuid().describe("Unique workflow identifier"),
  status: z
    .enum(["pending", "running", "completed", "failed", "cancelled"])
    .describe("Current workflow status"),
  task: z.string().describe("The task to be performed"),
  criteria: z.array(z.string()).describe("Evaluation criteria"),
  maxIterations: z.number().int().positive().describe("Maximum allowed iterations"),
  scoreThreshold: z.number().min(0).max(1).describe("Score threshold for success"),
  currentIteration: z.number().int().min(0).describe("Current iteration number"),
  iterations: z.array(IterationStateSchema).describe("History of all iterations"),
  finalOutput: z.string().optional().describe("Final accepted output"),
  finalScore: z.number().min(0).max(1).optional().describe("Final achieved score"),
  error: z.string().optional().describe("Error message if failed"),
  createdAt: z.string().datetime().describe("Creation timestamp"),
  updatedAt: z.string().datetime().describe("Last update timestamp"),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe("Additional metadata"),
});

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

/**
 * Final result of a completed workflow
 */
export const WorkflowResultSchema = z.object({
  success: z.boolean().describe("Whether the workflow succeeded"),
  workflowId: z.string().uuid().describe("Workflow identifier"),
  output: z.string().describe("Final output content"),
  iterations: z.number().int().positive().describe("Total iterations executed"),
  finalScore: z.number().min(0).max(1).describe("Final quality score"),
  totalDurationMs: z.number().describe("Total duration in milliseconds"),
  reason: z
    .enum(["threshold_reached", "max_iterations", "stagnation", "error", "cancelled", "early_termination"])
    .optional()
    .describe("Reason for workflow completion"),
  iterationHistory: z
    .array(IterationStateSchema)
    .optional()
    .describe("Complete iteration history"),
  estimatedCostUsd: z.number().optional().describe("Estimated cost in USD"),
});

export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;

/**
 * Request to start a new workflow
 */
export const WorkflowRequestSchema = z.object({
  task: z.string().min(1).max(10240).describe("The task to be performed"),
  criteria: z.array(z.string().min(1)).min(1).max(20).describe("Evaluation criteria"),
  maxIterations: z.number().int().min(1).max(50).default(10).describe("Maximum iterations"),
  scoreThreshold: z.number().min(0).max(1).default(0.85).describe("Score threshold"),
  mode: z.enum(["sync", "async"]).default("sync").describe("Execution mode"),
  generatorModel: z.string().default("claude-sonnet-4-20250514").describe("Generator model"),
  discriminatorModel: z.string().default("claude-sonnet-4-20250514").describe("Discriminator model"),
});

export type WorkflowRequest = z.infer<typeof WorkflowRequestSchema>;
