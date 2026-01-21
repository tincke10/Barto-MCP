import { BaseRunner, type BaseRunnerConfig, type RunnerResult } from "./base.runner.js";
import { buildGeneratorSystemPrompt, buildGeneratorUserPrompt } from "./prompts/generator.prompt.js";
import type { DiscriminatorFeedback } from "../../schemas/workflow.schema.js";
import { logger } from "../../shared/utils/logger.js";

/**
 * Parameters for generator execution
 */
export interface GeneratorParams {
  /** The task to perform */
  task: string;
  /** Feedback from the previous iteration (if any) */
  previousFeedback: DiscriminatorFeedback | null;
  /** Current iteration number (1-based) */
  iterationNumber: number;
}

/**
 * Result from generator execution
 */
export interface GeneratorResult extends RunnerResult {
  /** The generated output */
  output: string;
}

/**
 * Generator Runner
 *
 * Responsible for generating content based on a task description
 * and incorporating feedback from previous iterations.
 *
 * The generator uses the LLM to produce output that aims to meet
 * the evaluation criteria specified by the discriminator.
 */
export class GeneratorRunner extends BaseRunner {
  constructor(config: BaseRunnerConfig) {
    super({
      ...config,
      maxTokens: config.maxTokens ?? 4096,
    });
  }

  /**
   * Run the generator to produce output
   *
   * @param params - Generation parameters
   * @returns Generator result with output and metadata
   */
  async run(params: GeneratorParams): Promise<GeneratorResult> {
    logger.debug(
      {
        runner: this.runnerName,
        iteration: params.iterationNumber,
        hasFeedback: !!params.previousFeedback,
        taskLength: params.task.length,
      },
      "Starting generator execution"
    );

    const systemPrompt = buildGeneratorSystemPrompt();
    const userPrompt = buildGeneratorUserPrompt(
      params.task,
      params.previousFeedback,
      params.iterationNumber
    );

    const result = await this.executeCompletion(systemPrompt, userPrompt);

    logger.info(
      {
        runner: this.runnerName,
        iteration: params.iterationNumber,
        outputLength: result.content.length,
        durationMs: result.durationMs,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      },
      "Generator execution completed"
    );

    return {
      ...result,
      output: result.content,
    };
  }
}
