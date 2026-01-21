import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runWorkflowTool } from "./run-workflow.tool.js";
import { getStatusTool } from "./get-status.tool.js";
import { cancelWorkflowTool } from "./cancel-workflow.tool.js";
import { listWorkflowsTool } from "./list-workflows.tool.js";
import { pingTool } from "./ping.tool.js";
import type { DerivedConfig } from "../config/index.js";
import { logger } from "../shared/utils/logger.js";
import { isAppError } from "../shared/errors/index.js";

/**
 * Tool definition interface
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: unknown, config: DerivedConfig) => Promise<unknown>;
}

/**
 * All available tools
 */
const tools: Tool[] = [
  pingTool,
  runWorkflowTool,
  getStatusTool,
  cancelWorkflowTool,
  listWorkflowsTool,
];

/**
 * Register all tools with the MCP server
 */
export function registerTools(server: Server, config: DerivedConfig): void {
  // Handler for listing available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  // Handler for tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      logger.warn({ toolName: name }, "Unknown tool requested");
      return {
        content: [{ type: "text", text: `Error: Unknown tool '${name}'` }],
        isError: true,
      };
    }

    logger.info({ tool: name }, "Executing tool");

    try {
      const result = await tool.execute(args, config);
      logger.debug({ tool: name }, "Tool executed successfully");

      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = isAppError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown error occurred";

      logger.error({ tool: name, error: errorMessage }, "Tool execution failed");

      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  logger.info({ toolCount: tools.length }, "Tools registered");
}

export { tools };
