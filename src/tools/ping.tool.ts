import type { Tool } from "./index.js";

/**
 * Simple ping tool for testing MCP connection
 */
export const pingTool: Tool = {
  name: "ping",
  description: "Test the MCP server connection. Returns 'pong' with server info.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Optional message to echo back",
      },
    },
    required: [],
  },
  execute: async (args: unknown) => {
    const input = args as { message?: string } | undefined;

    return {
      status: "pong",
      timestamp: new Date().toISOString(),
      server: "mcp-ralph-workflow",
      version: "0.1.0",
      message: input?.message ?? undefined,
    };
  },
};
