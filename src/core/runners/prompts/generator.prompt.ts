import type { DiscriminatorFeedback } from "../../../schemas/workflow.schema.js";
import { PROMPT_SECURITY_GUARDRAILS } from "../../../shared/constants/security.js";

/**
 * Build the system prompt for the generator
 *
 * @returns System prompt string
 */
export function buildGeneratorSystemPrompt(): string {
  return `${PROMPT_SECURITY_GUARDRAILS}

You are an expert content generator focused on producing high-quality, well-structured output.

Your role is to:
1. Carefully analyze the task requirements
2. If feedback from previous iterations is provided, use it to improve your output
3. Produce content that is specific, detailed, and well-organized
4. Focus on quality over quantity
5. Address all identified issues from previous feedback

Guidelines:
- Be precise and accurate in your content
- Structure your response clearly
- If the task involves code, ensure it is correct and follows best practices
- If the task involves text, ensure it is well-written and coherent
- Always aim to exceed the evaluation criteria`;
}

/**
 * Build the user prompt for the generator
 *
 * @param task - The task to perform
 * @param previousFeedback - Feedback from the previous iteration (if any)
 * @param iterationNumber - Current iteration number
 * @returns User prompt string
 */
export function buildGeneratorUserPrompt(
  task: string,
  previousFeedback: DiscriminatorFeedback | null,
  iterationNumber: number
): string {
  let prompt = `## Task\n${task}\n\n`;

  if (previousFeedback && iterationNumber > 1) {
    prompt += `## Feedback from Iteration ${iterationNumber - 1}\n`;
    prompt += `**Score:** ${(previousFeedback.score * 100).toFixed(0)}%\n`;
    prompt += `**Status:** ${previousFeedback.passed ? "PASSED" : "NEEDS IMPROVEMENT"}\n\n`;

    if (previousFeedback.issues.length > 0) {
      prompt += `**Issues to Address:**\n`;
      previousFeedback.issues.forEach((issue, index) => {
        prompt += `${index + 1}. ${issue}\n`;
      });
      prompt += "\n";
    }

    if (previousFeedback.suggestions) {
      prompt += `**Suggestions for Improvement:**\n${previousFeedback.suggestions}\n\n`;
    }

    if (previousFeedback.reasoning) {
      prompt += `**Evaluator's Reasoning:**\n${previousFeedback.reasoning}\n\n`;
    }

    prompt += `## Instructions\n`;
    prompt += `This is iteration #${iterationNumber}. `;
    prompt += `Generate an improved version that addresses ALL the issues identified above.\n`;
    prompt += `Focus especially on: ${previousFeedback.issues.slice(0, 3).join(", ")}\n`;
  } else {
    prompt += `## Instructions\n`;
    prompt += `This is the first iteration. Generate your best initial version.\n`;
    prompt += `Aim for high quality from the start.\n`;
  }

  return prompt;
}
