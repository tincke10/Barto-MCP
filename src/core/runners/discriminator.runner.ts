import { BaseRunner, type BaseRunnerConfig, type RunnerResult } from "./base.runner.js";
import {
  buildDiscriminatorSystemPrompt,
  buildDiscriminatorUserPrompt,
} from "./prompts/discriminator.prompt.js";
import {
  DiscriminatorFeedbackSchema,
  type DiscriminatorFeedback,
} from "../../schemas/workflow.schema.js";
import { logger } from "../../shared/utils/logger.js";

/**
 * Parameters for discriminator execution
 */
export interface DiscriminatorParams {
  /** The generated output to evaluate */
  output: string;
  /** Evaluation criteria */
  criteria: string[];
  /** Original task description */
  task: string;
}

/**
 * Result from discriminator execution
 */
export interface DiscriminatorResult extends RunnerResult {
  /** Structured feedback from evaluation */
  feedback: DiscriminatorFeedback;
}

/**
 * Discriminator Runner
 *
 * Responsible for evaluating generated content against specified criteria.
 * Uses the LLM to produce structured feedback that guides the generator
 * in subsequent iterations.
 *
 * Features:
 * - Multiple JSON parsing strategies for robustness
 * - Fallback feedback on parse errors
 * - Detailed logging for debugging
 */
export class DiscriminatorRunner extends BaseRunner {
  constructor(config: BaseRunnerConfig) {
    super({
      ...config,
      maxTokens: config.maxTokens ?? 2048,
    });
  }

  /**
   * Run the discriminator to evaluate output
   *
   * @param params - Evaluation parameters
   * @returns Discriminator result with feedback and metadata
   */
  async run(params: DiscriminatorParams): Promise<DiscriminatorResult> {
    logger.debug(
      {
        runner: this.runnerName,
        criteriaCount: params.criteria.length,
        outputLength: params.output.length,
        taskLength: params.task.length,
      },
      "Starting discriminator execution"
    );

    const systemPrompt = buildDiscriminatorSystemPrompt();
    const userPrompt = buildDiscriminatorUserPrompt(
      params.task,
      params.criteria,
      params.output
    );

    const result = await this.executeCompletion(systemPrompt, userPrompt);

    // Parse the response with multiple strategies
    const feedback = this.parseResponse(result.content);

    logger.info(
      {
        runner: this.runnerName,
        score: feedback.score,
        passed: feedback.passed,
        issueCount: feedback.issues.length,
        durationMs: result.durationMs,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      },
      "Discriminator execution completed"
    );

    return {
      ...result,
      feedback,
    };
  }

  /**
   * Parse the LLM response into structured feedback
   *
   * Uses multiple strategies to extract JSON:
   * 1. Try to parse the entire response as JSON
   * 2. Look for JSON in code blocks (```json ... ```)
   * 3. Extract the first balanced JSON object
   * 4. Return fallback feedback if all fail
   *
   * @param response - Raw LLM response
   * @returns Parsed feedback
   */
  private parseResponse(response: string): DiscriminatorFeedback {
    const strategies: Array<() => DiscriminatorFeedback | null> = [
      () => this.tryParseDirectJson(response),
      () => this.tryParseCodeBlock(response),
      () => this.tryExtractBalancedJson(response),
    ];

    for (const strategy of strategies) {
      const result = strategy();
      if (result) {
        return result;
      }
    }

    // All strategies failed, return fallback
    logger.warn(
      { responseLength: response.length, responsePreview: response.slice(0, 200) },
      "All JSON parsing strategies failed, using fallback feedback"
    );

    return this.createFallbackFeedback(response);
  }

  /**
   * Strategy 1: Try to parse the entire response as JSON
   */
  private tryParseDirectJson(response: string): DiscriminatorFeedback | null {
    try {
      const trimmed = response.trim();
      const parsed = JSON.parse(trimmed) as unknown;
      const validated = DiscriminatorFeedbackSchema.parse(parsed);
      logger.debug("Successfully parsed response as direct JSON");
      return validated;
    } catch {
      return null;
    }
  }

  /**
   * Strategy 2: Look for JSON in markdown code blocks
   */
  private tryParseCodeBlock(response: string): DiscriminatorFeedback | null {
    // Try ```json ... ``` blocks first
    const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)```/);
    if (jsonBlockMatch?.[1]) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1].trim()) as unknown;
        const validated = DiscriminatorFeedbackSchema.parse(parsed);
        logger.debug("Successfully parsed JSON from code block");
        return validated;
      } catch {
        // Continue to next strategy
      }
    }

    // Try generic ``` ... ``` blocks
    const genericBlockMatch = response.match(/```\s*([\s\S]*?)```/);
    if (genericBlockMatch?.[1]) {
      try {
        const parsed = JSON.parse(genericBlockMatch[1].trim()) as unknown;
        const validated = DiscriminatorFeedbackSchema.parse(parsed);
        logger.debug("Successfully parsed JSON from generic code block");
        return validated;
      } catch {
        // Continue to next strategy
      }
    }

    return null;
  }

  /**
   * Strategy 3: Extract the first balanced JSON object from the response
   */
  private tryExtractBalancedJson(response: string): DiscriminatorFeedback | null {
    // Find the first { in the response
    const startIndex = response.indexOf("{");
    if (startIndex === -1) {
      return null;
    }

    // Try to find the matching closing brace
    let depth = 0;
    let endIndex = -1;

    for (let i = startIndex; i < response.length; i++) {
      const char = response[i];
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex === -1) {
      return null;
    }

    const jsonString = response.substring(startIndex, endIndex + 1);

    try {
      const parsed = JSON.parse(jsonString) as unknown;
      const validated = DiscriminatorFeedbackSchema.parse(parsed);
      logger.debug("Successfully extracted balanced JSON object");
      return validated;
    } catch {
      return null;
    }
  }

  /**
   * Create fallback feedback when parsing fails
   *
   * Returns a low-score feedback indicating the parse error
   */
  private createFallbackFeedback(rawResponse: string): DiscriminatorFeedback {
    logger.error(
      {
        responsePreview: rawResponse.slice(0, 500),
      },
      "Creating fallback feedback due to parse failure"
    );

    return {
      passed: false,
      score: 0.3,
      issues: [
        "Evaluation response could not be parsed",
        "The evaluator did not return valid JSON feedback",
      ],
      suggestions:
        "The system will retry the evaluation. If this persists, the workflow may need manual review.",
      reasoning:
        "Parse error occurred while processing the discriminator response. " +
        "This is a system issue, not a reflection of the content quality.",
    };
  }
}
