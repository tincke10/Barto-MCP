import pino from "pino";

/**
 * Create a configured logger instance.
 * Call this after loadConfig() has been executed.
 */
export function createLogger(level: string = "info", isDevelopment: boolean = false) {
  const baseConfig = {
    level,
    base: {
      service: "mcp-ralph-workflow",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (isDevelopment) {
    return pino({
      ...baseConfig,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    });
  }

  return pino(baseConfig);
}

// Default logger instance (will be replaced after config is loaded)
let _logger = createLogger();

/**
 * Initialize logger with configuration.
 * Should be called after loadConfig().
 */
export function initLogger(level: string, isDevelopment: boolean): void {
  _logger = createLogger(level, isDevelopment);
}

/**
 * Get the current logger instance
 */
export function getLogger() {
  return _logger;
}

/**
 * Proxy for convenient logger access
 */
export const logger = new Proxy({} as pino.Logger, {
  get(_, prop: string) {
    const loggerInstance = getLogger();
    const value = loggerInstance[prop as keyof pino.Logger];
    if (typeof value === "function") {
      return value.bind(loggerInstance);
    }
    return value;
  },
});

/**
 * Create a child logger with additional context
 */
export function createChildLogger(bindings: Record<string, unknown>) {
  return getLogger().child(bindings);
}
