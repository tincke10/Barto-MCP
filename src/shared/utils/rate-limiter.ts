import { getRedisClient, type ResilientRedisClient } from "../../infrastructure/persistence/redis/client.js";
import { logger } from "./logger.js";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Key prefix for rate limit entries */
  keyPrefix?: string;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests in the window */
  remaining: number;
  /** Total limit */
  limit: number;
  /** Time until reset in seconds */
  resetInSeconds: number;
  /** Number of requests made in current window */
  current: number;
}

/**
 * In-memory rate limit store for fallback
 */
class InMemoryRateLimitStore {
  private store: Map<string, { count: number; windowStart: number }> = new Map();

  check(key: string, maxRequests: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const entry = this.store.get(key);

    // Clean up expired entries periodically
    if (Math.random() < 0.1) {
      this.cleanup(windowMs);
    }

    if (!entry || now - entry.windowStart >= windowMs) {
      // New window
      this.store.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        limit: maxRequests,
        resetInSeconds: windowSeconds,
        current: 1,
      };
    }

    // Existing window
    const remaining = maxRequests - entry.count - 1;
    const resetInSeconds = Math.ceil((entry.windowStart + windowMs - now) / 1000);

    if (entry.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        limit: maxRequests,
        resetInSeconds,
        current: entry.count,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      limit: maxRequests,
      resetInSeconds,
      current: entry.count,
    };
  }

  private cleanup(windowMs: number): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.windowStart >= windowMs) {
        this.store.delete(key);
      }
    }
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Sliding Window Rate Limiter
 *
 * Implements a sliding window rate limiter using Redis with
 * automatic fallback to in-memory storage.
 *
 * Uses the sliding window log algorithm for accuracy.
 */
export class RateLimiter {
  private redis: ResilientRedisClient;
  private fallback: InMemoryRateLimitStore;
  private config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    this.redis = getRedisClient();
    this.fallback = new InMemoryRateLimitStore();
    this.config = {
      maxRequests: config.maxRequests,
      windowSeconds: config.windowSeconds,
      keyPrefix: config.keyPrefix ?? "ratelimit:",
    };
  }

  /**
   * Get the Redis key for a client
   */
  private getKey(clientId: string): string {
    return `${this.config.keyPrefix}${clientId}`;
  }

  /**
   * Check if a request is allowed and consume one token
   */
  async check(clientId: string): Promise<RateLimitResult> {
    const key = this.getKey(clientId);
    const now = Date.now();
    const windowMs = this.config.windowSeconds * 1000;
    const windowStart = now - windowMs;

    try {
      const rawClient = this.redis.getRawClient();
      if (!rawClient) {
        // Use fallback
        return this.fallback.check(
          clientId,
          this.config.maxRequests,
          this.config.windowSeconds
        );
      }

      // Use Redis sorted set for sliding window
      const multi = rawClient.multi();

      // Remove old entries outside the window
      multi.zremrangebyscore(key, 0, windowStart);

      // Count current entries
      multi.zcard(key);

      // Add new entry with current timestamp
      multi.zadd(key, now, `${now}-${Math.random()}`);

      // Set TTL to clean up the key
      multi.expire(key, this.config.windowSeconds + 1);

      const results = await multi.exec();

      if (!results) {
        return this.fallback.check(
          clientId,
          this.config.maxRequests,
          this.config.windowSeconds
        );
      }

      // results[1] is the count before adding the new entry
      const currentCount = (results[1]?.[1] as number) ?? 0;
      const allowed = currentCount < this.config.maxRequests;
      const remaining = Math.max(0, this.config.maxRequests - currentCount - 1);

      // Calculate reset time (end of current window)
      const oldestEntry = await rawClient.zrange(key, 0, 0, "WITHSCORES");
      let resetInSeconds = this.config.windowSeconds;
      if (oldestEntry.length >= 2 && oldestEntry[1] !== undefined) {
        const oldestTimestamp = parseInt(oldestEntry[1], 10);
        resetInSeconds = Math.max(
          1,
          Math.ceil((oldestTimestamp + windowMs - now) / 1000)
        );
      }

      if (!allowed) {
        // Remove the entry we just added since request is denied
        await rawClient.zremrangebyscore(key, now, now + 1);

        logger.warn(
          {
            clientId,
            current: currentCount,
            limit: this.config.maxRequests,
            resetInSeconds,
          },
          "Rate limit exceeded"
        );
      }

      return {
        allowed,
        remaining: allowed ? remaining : 0,
        limit: this.config.maxRequests,
        resetInSeconds,
        current: currentCount + (allowed ? 1 : 0),
      };
    } catch (error) {
      logger.warn(
        {
          clientId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Redis rate limit check failed, using fallback"
      );

      return this.fallback.check(
        clientId,
        this.config.maxRequests,
        this.config.windowSeconds
      );
    }
  }

  /**
   * Check if a request would be allowed without consuming a token
   */
  async peek(clientId: string): Promise<RateLimitResult> {
    const key = this.getKey(clientId);
    const now = Date.now();
    const windowMs = this.config.windowSeconds * 1000;
    const windowStart = now - windowMs;

    try {
      const rawClient = this.redis.getRawClient();
      if (!rawClient) {
        // For peek, just check without incrementing
        const result = this.fallback.check(
          clientId,
          this.config.maxRequests,
          this.config.windowSeconds
        );
        // Undo the increment
        this.fallback.reset(clientId);
        return result;
      }

      // Remove old entries and count
      await rawClient.zremrangebyscore(key, 0, windowStart);
      const currentCount = await rawClient.zcard(key);

      const allowed = currentCount < this.config.maxRequests;
      const remaining = Math.max(0, this.config.maxRequests - currentCount);

      return {
        allowed,
        remaining,
        limit: this.config.maxRequests,
        resetInSeconds: this.config.windowSeconds,
        current: currentCount,
      };
    } catch (error) {
      logger.warn(
        {
          clientId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Redis rate limit peek failed"
      );

      return {
        allowed: true,
        remaining: this.config.maxRequests,
        limit: this.config.maxRequests,
        resetInSeconds: this.config.windowSeconds,
        current: 0,
      };
    }
  }

  /**
   * Reset rate limit for a client
   */
  async reset(clientId: string): Promise<void> {
    const key = this.getKey(clientId);

    try {
      await this.redis.del(key);
      this.fallback.reset(clientId);
    } catch (error) {
      logger.warn(
        {
          clientId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to reset rate limit"
      );
      this.fallback.reset(clientId);
    }
  }

  /**
   * Get rate limit headers for HTTP responses
   */
  getHeaders(result: RateLimitResult): Record<string, string> {
    return {
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(result.resetInSeconds),
    };
  }
}

/**
 * Default rate limiters for different use cases
 */

// Workflow execution: 10 per minute
let workflowRateLimiter: RateLimiter | null = null;

export function getWorkflowRateLimiter(): RateLimiter {
  if (!workflowRateLimiter) {
    workflowRateLimiter = new RateLimiter({
      maxRequests: 10,
      windowSeconds: 60,
      keyPrefix: "ratelimit:workflow:",
    });
  }
  return workflowRateLimiter;
}

// API calls: 100 per minute
let apiRateLimiter: RateLimiter | null = null;

export function getApiRateLimiter(): RateLimiter {
  if (!apiRateLimiter) {
    apiRateLimiter = new RateLimiter({
      maxRequests: 100,
      windowSeconds: 60,
      keyPrefix: "ratelimit:api:",
    });
  }
  return apiRateLimiter;
}

/**
 * Create a custom rate limiter
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  return new RateLimiter(config);
}

/**
 * Reset all rate limiters (for testing)
 */
export function resetRateLimiters(): void {
  workflowRateLimiter = null;
  apiRateLimiter = null;
}
