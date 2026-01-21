import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { registerTools } from "./tools/index.js";
import type { DerivedConfig } from "./config/index.js";
import { logger } from "./shared/utils/logger.js";

/**
 * Create and configure the MCP server
 */
export function createServer(config: DerivedConfig): Server {
  const server = new Server(
    {
      name: "ralph-workflow",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register all tools
  registerTools(server, config);

  // Global error handling
  server.onerror = (error) => {
    logger.error({ error: error.message }, "MCP Server error");
  };

  // Connection lifecycle logging
  server.onclose = () => {
    logger.info("MCP Server connection closed");
  };

  logger.info("MCP Server created and configured");

  return server;
}
