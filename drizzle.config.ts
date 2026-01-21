import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/persistence/postgres/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ralph",
  },
  verbose: true,
  strict: true,
});
