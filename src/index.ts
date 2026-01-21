#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { loadConfig, getDerivedConfig } from "./config/index.js";
import { initLogger, logger } from "./shared/utils/logger.js";
import { initializeLLMFactory } from "./infrastructure/llm/index.js";

/**
 * Main entry point for the MCP Ralph Workflow Server
 */
async function main() {
  // Load and validate configuration
  const envConfig = loadConfig();

  // Initialize logger with config
  initLogger(envConfig.LOG_LEVEL, envConfig.NODE_ENV === "development");

  logger.info("Starting MCP Ralph Workflow Server...");
  logger.debug({ nodeEnv: envConfig.NODE_ENV }, "Configuration loaded");

  // Get derived config for easier access
  const config = getDerivedConfig();

  // Initialize LLM Factory with API keys
  initializeLLMFactory({
    anthropicApiKey: config.anthropicApiKey,
    ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
    timeoutMs: config.llmTimeoutMs,
  });
  logger.debug("LLM Factory initialized");

  // Create the MCP server
  const server = createServer(config);

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  logger.info("MCP Server connected and ready");

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down MCP Server...");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Run the server
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Fatal error:", message);
  process.exit(1);
});
