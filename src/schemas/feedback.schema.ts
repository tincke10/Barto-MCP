import { z } from "zod";

/**
 * Criterion evaluation for a single criterion
 */
export const CriterionEvaluationSchema = z.object({
  criterion: z.string().describe("The criterion being evaluated"),
  met: z.boolean().describe("Whether the criterion was met"),
  score: z.number().min(0).max(1).describe("Score for this criterion"),
  feedback: z.string().describe("Specific feedback for this criterion"),
});

export type CriterionEvaluation = z.infer<typeof CriterionEvaluationSchema>;

/**
 * Detailed evaluation with per-criterion breakdown
 */
export const DetailedEvaluationSchema = z.object({
  overallScore: z.number().min(0).max(1),
  passed: z.boolean(),
  criteriaEvaluations: z.array(CriterionEvaluationSchema),
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

export type DetailedEvaluation = z.infer<typeof DetailedEvaluationSchema>;

/**
 * Feedback request for discriminator
 */
export const FeedbackRequestSchema = z.object({
  output: z.string().describe("The generated output to evaluate"),
  criteria: z.array(z.string()).describe("Criteria to evaluate against"),
  task: z.string().describe("Original task description"),
  previousFeedback: z
    .object({
      score: z.number(),
      issues: z.array(z.string()),
    })
    .optional()
    .describe("Previous feedback for context"),
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
