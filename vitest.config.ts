import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "tests/**",
        "**/*.config.*",
        "**/*.d.ts",
        "src/index.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ["verbose"],
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/core": resolve(__dirname, "./src/core"),
      "@/tools": resolve(__dirname, "./src/tools"),
      "@/infrastructure": resolve(__dirname, "./src/infrastructure"),
      "@/shared": resolve(__dirname, "./src/shared"),
      "@/schemas": resolve(__dirname, "./src/schemas"),
      "@/config": resolve(__dirname, "./src/config"),
      "@/domain": resolve(__dirname, "./src/domain"),
    },
  },
});
