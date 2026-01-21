import { Queue, Worker, QueueEvents } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { logger } from "../../shared/utils/logger.js";

/**
 * Queue client configuration
 */
export interface QueueClientConfig {
  /** Redis connection options */
  connection?: ConnectionOptions;
  /** Default job options */
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: "exponential" | "fixed";
      delay: number;
    };
    removeOnComplete?: boolean | number;
    removeOnFail?: boolean | number;
  };
}

/**
 * Parse Redis URL to connection options
 */
export function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.username ? { username: parsed.username } : {}),
  };
}

/**
 * Get default connection options
 */
export function getDefaultConnection(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  return parseRedisUrl(redisUrl);
}

/**
 * Default job options
 */
export const DEFAULT_JOB_OPTIONS: {
  attempts: number;
  backoff: { type: "exponential"; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: 100, // Keep last 100 completed jobs
  removeOnFail: 50, // Keep last 50 failed jobs
};

/**
 * Queue names
 */
export const QUEUE_NAMES = {
  WORKFLOW: "workflow-execution",
} as const;

/**
 * Queue manager for centralized queue access
 */
export class QueueManager {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private events: Map<string, QueueEvents> = new Map();
  private connection: ConnectionOptions;
  private defaultJobOptions: typeof DEFAULT_JOB_OPTIONS;

  constructor(config: QueueClientConfig = {}) {
    this.connection = config.connection ?? getDefaultConnection();
    this.defaultJobOptions = { ...DEFAULT_JOB_OPTIONS };

    if (config.defaultJobOptions?.attempts !== undefined) {
      this.defaultJobOptions.attempts = config.defaultJobOptions.attempts;
    }
    if (config.defaultJobOptions?.backoff) {
      this.defaultJobOptions.backoff = {
        type: "exponential",
        delay: config.defaultJobOptions.backoff.delay,
      };
    }
    if (typeof config.defaultJobOptions?.removeOnComplete === "number") {
      this.defaultJobOptions.removeOnComplete = config.defaultJobOptions.removeOnComplete;
    }
    if (typeof config.defaultJobOptions?.removeOnFail === "number") {
      this.defaultJobOptions.removeOnFail = config.defaultJobOptions.removeOnFail;
    }
  }

  /**
   * Get or create a queue
   */
  getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: this.defaultJobOptions,
      });

      this.queues.set(name, queue);
      logger.debug({ queueName: name }, "Queue created");
    }

    return this.queues.get(name)!;
  }

  /**
   * Create a worker for a queue
   */
  createWorker<T = unknown, R = unknown>(
    queueName: string,
    processor: (job: { id?: string; name: string; data: T }) => Promise<R>,
    options: {
      concurrency?: number;
      limiter?: {
        max: number;
        duration: number;
      };
    } = {}
  ): Worker<T, R> {
    if (this.workers.has(queueName)) {
      logger.warn({ queueName }, "Worker already exists for queue");
      return this.workers.get(queueName) as Worker<T, R>;
    }

    const workerOptions: {
      connection: ConnectionOptions;
      concurrency: number;
      limiter?: { max: number; duration: number };
    } = {
      connection: this.connection,
      concurrency: options.concurrency ?? 1,
    };

    if (options.limiter) {
      workerOptions.limiter = options.limiter;
    }

    const worker = new Worker<T, R>(queueName, processor, workerOptions);

    // Setup event handlers
    worker.on("completed", (job) => {
      logger.debug({ jobId: job.id, queueName }, "Job completed");
    });

    worker.on("failed", (job, error) => {
      logger.error(
        { jobId: job?.id, queueName, error: error.message },
        "Job failed"
      );
    });

    worker.on("error", (error) => {
      logger.error({ queueName, error: error.message }, "Worker error");
    });

    this.workers.set(queueName, worker);
    logger.info({ queueName, concurrency: options.concurrency || 1 }, "Worker created");

    return worker;
  }

  /**
   * Get queue events for monitoring
   */
  getQueueEvents(queueName: string): QueueEvents {
    if (!this.events.has(queueName)) {
      const events = new QueueEvents(queueName, {
        connection: this.connection,
      });

      this.events.set(queueName, events);
    }

    return this.events.get(queueName)!;
  }

  /**
   * Close all queues and workers
   */
  async close(): Promise<void> {
    // Close workers first
    for (const [name, worker] of this.workers) {
      await worker.close();
      logger.debug({ queueName: name }, "Worker closed");
    }
    this.workers.clear();

    // Close queue events
    for (const [name, events] of this.events) {
      await events.close();
      logger.debug({ queueName: name }, "Queue events closed");
    }
    this.events.clear();

    // Close queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.debug({ queueName: name }, "Queue closed");
    }
    this.queues.clear();

    logger.info("All queues and workers closed");
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queue = this.getQueue(queueName);
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}

// Singleton instance
let queueManager: QueueManager | null = null;

/**
 * Get or create the queue manager singleton
 */
export function getQueueManager(config?: QueueClientConfig): QueueManager {
  if (!queueManager) {
    queueManager = new QueueManager(config);
  }
  return queueManager;
}

/**
 * Reset the queue manager (for testing)
 */
export async function resetQueueManager(): Promise<void> {
  if (queueManager) {
    await queueManager.close();
    queueManager = null;
  }
}
