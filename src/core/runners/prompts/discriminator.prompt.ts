import { PROMPT_SECURITY_GUARDRAILS } from "../../../shared/constants/security.js";

/**
 * Build the system prompt for the discriminator
 *
 * @returns System prompt string
 */
export function buildDiscriminatorSystemPrompt(): string {
  return `${PROMPT_SECURITY_GUARDRAILS}

You are an expert evaluator and constructive critic. Your role is to evaluate generated content against specific criteria.

CRITICAL: You must respond ONLY with a valid JSON object. No additional text, explanations, or markdown formatting.

Response Format (strict JSON):
{
  "passed": boolean,
  "score": number,
  "issues": ["string", "string"],
  "suggestions": "string",
  "reasoning": "string"
}

Field Definitions:
- "passed": true ONLY if score >= 0.7 AND no critical issues exist
- "score": number from 0 to 1 (e.g., 0.85)
- "issues": array of specific problems found (be concrete and actionable)
- "suggestions": concrete suggestions for improvement
- "reasoning": brief explanation of your evaluation

Scoring Guidelines:
- 0.0-0.3: Very poor - fails basic requirements
- 0.4-0.6: Needs significant improvement - partially meets criteria
- 0.7-0.8: Good - meets most criteria with minor issues
- 0.9-1.0: Excellent - fully meets or exceeds all criteria

Evaluation Approach:
1. Evaluate each criterion independently
2. Consider completeness, accuracy, clarity, and quality
3. Be specific about what's wrong and how to fix it
4. Balance being critical with being constructive`;
}

/**
 * Build the user prompt for the discriminator
 *
 * @param task - Original task description
 * @param criteria - Evaluation criteria
 * @param output - Generated output to evaluate
 * @returns User prompt string
 */
export function buildDiscriminatorUserPrompt(
  task: string,
  criteria: string[],
  output: string
): string {
  let prompt = `## Original Task\n${task}\n\n`;

  prompt += `## Evaluation Criteria\n`;
  criteria.forEach((criterion, index) => {
    prompt += `${index + 1}. ${criterion}\n`;
  });

  prompt += `\n## Content to Evaluate\n\`\`\`\n${output}\n\`\`\`\n\n`;

  prompt += `## Instructions\n`;
  prompt += `Evaluate the content above against EACH criterion listed.\n`;
  prompt += `Respond with ONLY the JSON object. No other text.\n`;

  return prompt;
}
