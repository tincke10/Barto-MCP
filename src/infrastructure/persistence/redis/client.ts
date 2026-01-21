import { Redis } from "ioredis";
type RedisClient = Redis;
import { logger } from "../../../shared/utils/logger.js";

/**
 * Configuration for Redis client
 */
export interface RedisClientConfig {
  /** Redis connection URL */
  url?: string;
  /** Connection timeout in ms */
  connectTimeout?: number;
  /** Max retries before falling back */
  maxRetriesPerRequest?: number;
  /** Enable offline queue */
  enableOfflineQueue?: boolean;
}

/**
 * In-memory fallback store entry
 */
interface StoreEntry {
  value: string;
  expireAt: number | null;
}

/**
 * In-memory fallback store when Redis is unavailable
 */
class InMemoryStore {
  private store: Map<string, StoreEntry> = new Map();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;

    if (item.expireAt !== null && Date.now() > item.expireAt) {
      this.store.delete(key);
      return null;
    }

    return item.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expireAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expireAt });
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return Array.from(this.store.keys()).filter((key) => regex.test(key));
  }

  async exists(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;

    if (item.expireAt !== null && Date.now() > item.expireAt) {
      this.store.delete(key);
      return 0;
    }

    return 1;
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * Resilient Redis Client
 *
 * Provides a Redis client with automatic fallback to in-memory storage
 * when Redis is unavailable. Supports auto-reconnection and health checks.
 */
export class ResilientRedisClient {
  private redis: RedisClient | null = null;
  private fallback: InMemoryStore;
  private isConnected: boolean = false;
  private usesFallback: boolean = false;
  private config: RedisClientConfig;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  constructor(config: RedisClientConfig = {}) {
    this.config = {
      url: config.url || process.env.REDIS_URL || "redis://localhost:6379",
      connectTimeout: config.connectTimeout || 5000,
      maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
      enableOfflineQueue: config.enableOfflineQueue ?? false,
    };
    this.fallback = new InMemoryStore();
  }

  /**
   * Initialize the Redis connection
   */
  async connect(): Promise<void> {
    try {
      const redisOptions: {
        connectTimeout?: number;
        maxRetriesPerRequest?: number;
        enableOfflineQueue?: boolean;
        retryStrategy: (times: number) => number | null;
      } = {
        retryStrategy: (times: number) => {
          if (times > this.maxReconnectAttempts) {
            logger.warn(
              { attempts: times },
              "Max Redis reconnection attempts reached, using fallback"
            );
            this.switchToFallback();
            return null;
          }
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
      };

      if (this.config.connectTimeout !== undefined) {
        redisOptions.connectTimeout = this.config.connectTimeout;
      }
      if (this.config.maxRetriesPerRequest !== undefined) {
        redisOptions.maxRetriesPerRequest = this.config.maxRetriesPerRequest;
      }
      if (this.config.enableOfflineQueue !== undefined) {
        redisOptions.enableOfflineQueue = this.config.enableOfflineQueue;
      }

      this.redis = new Redis(this.config.url ?? "redis://localhost:6379", redisOptions);

      this.setupEventHandlers();

      // Test connection
      await this.redis.ping();
      this.isConnected = true;
      this.usesFallback = false;
      this.reconnectAttempts = 0;

      logger.info({ url: this.config.url }, "Redis connected successfully");
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Redis connection failed, using in-memory fallback"
      );
      this.switchToFallback();
    }
  }

  /**
   * Setup Redis event handlers for connection management
   */
  private setupEventHandlers(): void {
    if (!this.redis) return;

    this.redis.on("connect", () => {
      logger.debug("Redis connecting...");
    });

    this.redis.on("ready", () => {
      this.isConnected = true;
      this.usesFallback = false;
      this.reconnectAttempts = 0;
      logger.info("Redis connection ready");
    });

    this.redis.on("error", (error: Error) => {
      logger.error({ error: error.message }, "Redis error");
    });

    this.redis.on("close", () => {
      this.isConnected = false;
      logger.warn("Redis connection closed");
    });

    this.redis.on("reconnecting", () => {
      this.reconnectAttempts++;
      logger.info(
        { attempt: this.reconnectAttempts },
        "Redis reconnecting..."
      );
    });

    this.redis.on("end", () => {
      this.isConnected = false;
      logger.warn("Redis connection ended");
    });
  }

  /**
   * Switch to in-memory fallback
   */
  private switchToFallback(): void {
    this.usesFallback = true;
    this.isConnected = false;
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
    logger.info("Switched to in-memory fallback store");
  }

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    if (this.usesFallback) {
      return this.fallback.get(key);
    }

    try {
      return await this.redis!.get(key);
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis get failed, using fallback"
      );
      return this.fallback.get(key);
    }
  }

  /**
   * Set a value with optional TTL
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.usesFallback) {
      await this.fallback.set(key, value, ttlSeconds);
      return;
    }

    try {
      if (ttlSeconds) {
        await this.redis!.setex(key, ttlSeconds, value);
      } else {
        await this.redis!.set(key, value);
      }
      // Also update fallback for consistency
      await this.fallback.set(key, value, ttlSeconds);
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis set failed, using fallback"
      );
      await this.fallback.set(key, value, ttlSeconds);
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<number> {
    if (this.usesFallback) {
      return this.fallback.del(key);
    }

    try {
      const result = await this.redis!.del(key);
      await this.fallback.del(key);
      return result;
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis del failed, using fallback"
      );
      return this.fallback.del(key);
    }
  }

  /**
   * Get keys matching a pattern
   */
  async keys(pattern: string): Promise<string[]> {
    if (this.usesFallback) {
      return this.fallback.keys(pattern);
    }

    try {
      return await this.redis!.keys(pattern);
    } catch (error) {
      logger.warn(
        { pattern, error: error instanceof Error ? error.message : String(error) },
        "Redis keys failed, using fallback"
      );
      return this.fallback.keys(pattern);
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    if (this.usesFallback) {
      return (await this.fallback.exists(key)) === 1;
    }

    try {
      return (await this.redis!.exists(key)) === 1;
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis exists failed, using fallback"
      );
      return (await this.fallback.exists(key)) === 1;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; mode: "redis" | "fallback"; latencyMs?: number }> {
    if (this.usesFallback) {
      return { healthy: true, mode: "fallback" };
    }

    try {
      const start = Date.now();
      await this.redis!.ping();
      const latencyMs = Date.now() - start;
      return { healthy: true, mode: "redis", latencyMs };
    } catch (error) {
      return { healthy: false, mode: "fallback" };
    }
  }

  /**
   * Get connection status
   */
  getStatus(): { isConnected: boolean; usesFallback: boolean; fallbackSize: number } {
    return {
      isConnected: this.isConnected,
      usesFallback: this.usesFallback,
      fallbackSize: this.fallback.size(),
    };
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
    this.isConnected = false;
    logger.info("Redis client disconnected");
  }

  /**
   * Get the raw Redis client (for advanced operations)
   * Returns null if using fallback
   */
  getRawClient(): RedisClient | null {
    return this.redis;
  }
}

// Singleton instance
let redisClient: ResilientRedisClient | null = null;

/**
 * Get or create the Redis client singleton
 */
export function getRedisClient(config?: RedisClientConfig): ResilientRedisClient {
  if (!redisClient) {
    redisClient = new ResilientRedisClient(config);
  }
  return redisClient;
}

/**
 * Initialize and connect the Redis client
 */
export async function initializeRedis(config?: RedisClientConfig): Promise<ResilientRedisClient> {
  const client = getRedisClient(config);
  await client.connect();
  return client;
}

/**
 * Reset the Redis client (for testing)
 */
export function resetRedisClient(): void {
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}
