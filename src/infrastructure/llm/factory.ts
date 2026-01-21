import type { LLMProvider, LLMProviderType } from "./providers/base.provider.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import { LLMProviderError, LLMAuthenticationError } from "../../shared/errors/index.js";
import { logger } from "../../shared/utils/logger.js";

/**
 * Configuration for creating LLM providers
 */
export interface LLMFactoryConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  timeoutMs?: number;
}

/**
 * Singleton instances of LLM providers
 */
const providerInstances: Map<LLMProviderType, LLMProvider> = new Map();

/**
 * Factory configuration (set once at startup)
 */
let factoryConfig: LLMFactoryConfig | null = null;

/**
 * Initialize the LLM factory with configuration
 *
 * This should be called once at application startup.
 *
 * @param config - Factory configuration with API keys and settings
 */
export function initializeLLMFactory(config: LLMFactoryConfig): void {
  if (factoryConfig) {
    logger.warn("LLM Factory already initialized, reinitializing...");
    resetProviderInstances();
  }

  factoryConfig = config;
  logger.info(
    {
      hasAnthropicKey: !!config.anthropicApiKey,
      hasOpenaiKey: !!config.openaiApiKey,
      timeoutMs: config.timeoutMs,
    },
    "LLM Factory initialized"
  );
}

/**
 * Get or create an LLM provider instance (singleton pattern)
 *
 * @param providerType - The type of provider to create
 * @returns The LLM provider instance
 * @throws LLMProviderError if factory not initialized
 * @throws LLMAuthenticationError if API key not configured
 */
export function getLLMProvider(providerType: LLMProviderType): LLMProvider {
  // Check if factory is initialized
  if (!factoryConfig) {
    throw new LLMProviderError(
      providerType,
      "LLM Factory not initialized. Call initializeLLMFactory() first."
    );
  }

  // Return existing instance if available
  const existingInstance = providerInstances.get(providerType);
  if (existingInstance) {
    return existingInstance;
  }

  // Create new instance
  const instance = createProviderInstance(providerType, factoryConfig);
  providerInstances.set(providerType, instance);

  logger.debug({ provider: providerType }, "Created new LLM provider instance");

  return instance;
}

/**
 * Create a new provider instance
 *
 * @param providerType - Type of provider to create
 * @param config - Factory configuration
 * @returns New provider instance
 */
function createProviderInstance(
  providerType: LLMProviderType,
  config: LLMFactoryConfig
): LLMProvider {
  const timeoutMs = config.timeoutMs ?? 60000;

  switch (providerType) {
    case "anthropic": {
      if (!config.anthropicApiKey) {
        throw new LLMAuthenticationError("anthropic");
      }
      return new AnthropicProvider(config.anthropicApiKey, timeoutMs);
    }

    case "openai": {
      if (!config.openaiApiKey) {
        throw new LLMAuthenticationError("openai");
      }
      return new OpenAIProvider(config.openaiApiKey, timeoutMs);
    }

    default: {
      const exhaustiveCheck: never = providerType;
      throw new LLMProviderError(
        String(exhaustiveCheck),
        `Unknown provider type: ${String(exhaustiveCheck)}`
      );
    }
  }
}

/**
 * Reset all provider instances (useful for testing)
 *
 * This clears all singleton instances, allowing them to be recreated
 * with new configuration.
 */
export function resetProviderInstances(): void {
  providerInstances.clear();
  logger.debug("LLM provider instances cleared");
}

/**
 * Reset the entire factory (including configuration)
 *
 * This is primarily useful for testing scenarios where you need
 * to reinitialize with different configuration.
 */
export function resetLLMFactory(): void {
  resetProviderInstances();
  factoryConfig = null;
  logger.debug("LLM Factory reset");
}

/**
 * Check if a provider type is available (has API key configured)
 *
 * @param providerType - The provider type to check
 * @returns True if the provider can be used
 */
export function isProviderAvailable(providerType: LLMProviderType): boolean {
  if (!factoryConfig) {
    return false;
  }

  switch (providerType) {
    case "anthropic":
      return !!factoryConfig.anthropicApiKey;
    case "openai":
      return !!factoryConfig.openaiApiKey;
    default:
      return false;
  }
}

/**
 * Get the default provider based on configuration
 *
 * @param preferredProvider - Optional preferred provider type
 * @returns The available provider to use
 * @throws LLMProviderError if no providers are available
 */
export function getDefaultProvider(preferredProvider?: LLMProviderType): LLMProvider {
  // Try preferred provider first
  if (preferredProvider && isProviderAvailable(preferredProvider)) {
    return getLLMProvider(preferredProvider);
  }

  // Fall back to any available provider
  if (isProviderAvailable("anthropic")) {
    return getLLMProvider("anthropic");
  }

  if (isProviderAvailable("openai")) {
    return getLLMProvider("openai");
  }

  throw new LLMProviderError(
    "none",
    "No LLM providers available. Configure at least one API key."
  );
}

// Re-export types
export type { LLMProvider, LLMProviderType, CompletionParams, CompletionResponse } from "./providers/base.provider.js";
