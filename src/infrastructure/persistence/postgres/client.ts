import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import { logger } from "../../../shared/utils/logger.js";

const { Pool } = pg;

/**
 * PostgreSQL client configuration
 */
export interface PostgresClientConfig {
  /** Database connection URL */
  connectionString?: string;
  /** Maximum pool size */
  maxPoolSize?: number;
  /** Connection timeout in ms */
  connectionTimeoutMs?: number;
  /** Idle timeout in ms */
  idleTimeoutMs?: number;
}

/**
 * PostgreSQL database client wrapper
 */
export class PostgresClient {
  private pool: pg.Pool | null = null;
  private db: ReturnType<typeof drizzle<typeof schema>> | null = null;
  private config: PostgresClientConfig;
  private isConnected: boolean = false;

  constructor(config: PostgresClientConfig = {}) {
    const connectionString = config.connectionString ?? process.env.DATABASE_URL;
    this.config = {
      maxPoolSize: config.maxPoolSize ?? 10,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 30000,
      idleTimeoutMs: config.idleTimeoutMs ?? 10000,
      ...(connectionString ? { connectionString } : {}),
    };
  }

  /**
   * Initialize database connection
   */
  async connect(): Promise<void> {
    if (!this.config.connectionString) {
      logger.warn("DATABASE_URL not configured, PostgreSQL features disabled");
      return;
    }

    try {
      this.pool = new Pool({
        connectionString: this.config.connectionString,
        max: this.config.maxPoolSize,
        connectionTimeoutMillis: this.config.connectionTimeoutMs,
        idleTimeoutMillis: this.config.idleTimeoutMs,
      });

      // Test connection
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();

      this.db = drizzle(this.pool, { schema });
      this.isConnected = true;

      logger.info("PostgreSQL connected successfully");
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "PostgreSQL connection failed"
      );
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Get the Drizzle database instance
   */
  getDb(): ReturnType<typeof drizzle<typeof schema>> {
    if (!this.db) {
      throw new Error("PostgreSQL not connected. Call connect() first.");
    }
    return this.db;
  }

  /**
   * Get the raw pool (for advanced operations)
   */
  getPool(): pg.Pool | null {
    return this.pool;
  }

  /**
   * Check if connected
   */
  isAvailable(): boolean {
    return this.isConnected && this.db !== null;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number }> {
    if (!this.pool || !this.isConnected) {
      return { healthy: false };
    }

    try {
      const start = Date.now();
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();
      const latencyMs = Date.now() - start;
      return { healthy: true, latencyMs };
    } catch {
      return { healthy: false };
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.db = null;
      this.isConnected = false;
      logger.info("PostgreSQL disconnected");
    }
  }
}

// Singleton instance
let postgresClient: PostgresClient | null = null;

/**
 * Get or create the PostgreSQL client singleton
 */
export function getPostgresClient(config?: PostgresClientConfig): PostgresClient {
  if (!postgresClient) {
    postgresClient = new PostgresClient(config);
  }
  return postgresClient;
}

/**
 * Initialize and connect the PostgreSQL client
 */
export async function initializePostgres(
  config?: PostgresClientConfig
): Promise<PostgresClient> {
  const client = getPostgresClient(config);
  await client.connect();
  return client;
}

/**
 * Reset the PostgreSQL client (for testing)
 */
export async function resetPostgresClient(): Promise<void> {
  if (postgresClient) {
    await postgresClient.disconnect();
    postgresClient = null;
  }
}
