import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Workflow status enum
 */
export const workflowStatusEnum = pgEnum("workflow_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Audit action enum
 */
export const auditActionEnum = pgEnum("audit_action", [
  "workflow_created",
  "workflow_started",
  "workflow_completed",
  "workflow_failed",
  "workflow_cancelled",
  "iteration_completed",
]);

/**
 * Workflows table
 *
 * Stores completed workflow history for long-term persistence
 */
export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: workflowStatusEnum("status").notNull().default("pending"),
    task: text("task").notNull(),
    criteria: jsonb("criteria").$type<string[]>().notNull(),
    maxIterations: integer("max_iterations").notNull(),
    scoreThreshold: real("score_threshold").notNull(),
    finalOutput: text("final_output"),
    finalScore: real("final_score"),
    totalIterations: integer("total_iterations").default(0),
    stopReason: varchar("stop_reason", { length: 50 }),
    errorMessage: text("error_message"),
    generatorModel: varchar("generator_model", { length: 100 }),
    discriminatorModel: varchar("discriminator_model", { length: 100 }),
    totalDurationMs: integer("total_duration_ms"),
    totalTokensUsed: integer("total_tokens_used"),
    estimatedCostUsd: real("estimated_cost_usd"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workflows_status_idx").on(table.status),
    index("workflows_created_at_idx").on(table.createdAt),
    index("workflows_completed_at_idx").on(table.completedAt),
  ]
);

/**
 * Iterations table
 *
 * Stores iteration history for each workflow
 */
export const iterations = pgTable(
  "iterations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    iterationNumber: integer("iteration_number").notNull(),
    generatorOutput: text("generator_output").notNull(),
    score: real("score").notNull(),
    passed: integer("passed").notNull(), // Using integer as boolean (0/1)
    feedback: jsonb("feedback").$type<{
      score: number;
      passed: boolean;
      issues: string[];
      suggestions: string;
      reasoning: string;
    }>().notNull(),
    durationMs: integer("duration_ms"),
    generatorTokens: integer("generator_tokens"),
    discriminatorTokens: integer("discriminator_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("iterations_workflow_id_idx").on(table.workflowId),
    index("iterations_workflow_number_idx").on(table.workflowId, table.iterationNumber),
  ]
);

/**
 * Audit logs table
 *
 * Stores audit trail of all workflow actions
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    action: auditActionEnum("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    clientId: varchar("client_id", { length: 100 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_workflow_id_idx").on(table.workflowId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_client_id_idx").on(table.clientId),
  ]
);

/**
 * Relations
 */
export const workflowsRelations = relations(workflows, ({ many }) => ({
  iterations: many(iterations),
  auditLogs: many(auditLogs),
}));

export const iterationsRelations = relations(iterations, ({ one }) => ({
  workflow: one(workflows, {
    fields: [iterations.workflowId],
    references: [workflows.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  workflow: one(workflows, {
    fields: [auditLogs.workflowId],
    references: [workflows.id],
  }),
}));

/**
 * Type exports for use in repositories
 */
export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
export type Iteration = typeof iterations.$inferSelect;
export type NewIteration = typeof iterations.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
