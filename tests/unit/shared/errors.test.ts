import { describe, it, expect } from "vitest";
import {
  AppError,
  WorkflowNotFoundError,
  MaxIterationsExceededError,
  LLMTimeoutError,
  InputValidationError,
  isAppError,
} from "@/shared/errors/index.js";

describe("Errors", () => {
  describe("WorkflowNotFoundError", () => {
    it("should create error with correct properties", () => {
      const error = new WorkflowNotFoundError("test-id-123");

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("WORKFLOW_NOT_FOUND");
      expect(error.statusCode).toBe(404);
      expect(error.message).toContain("test-id-123");
      expect(error.context).toEqual({ workflowId: "test-id-123" });
    });

    it("should serialize to JSON correctly", () => {
      const error = new WorkflowNotFoundError("test-id");
      const json = error.toJSON();

      expect(json.code).toBe("WORKFLOW_NOT_FOUND");
      expect(json.statusCode).toBe(404);
      expect(json.context?.workflowId).toBe("test-id");
      expect(json.timestamp).toBeDefined();
    });

    it("should serialize to safe JSON without stack", () => {
      const error = new WorkflowNotFoundError("test-id");
      const json = error.toSafeJSON();

      expect(json.code).toBe("WORKFLOW_NOT_FOUND");
      expect((json as Record<string, unknown>).stack).toBeUndefined();
      expect((json as Record<string, unknown>).context).toBeUndefined();
    });
  });

  describe("MaxIterationsExceededError", () => {
    it("should create error with limits in context", () => {
      const error = new MaxIterationsExceededError(100, 50);

      expect(error.code).toBe("MAX_ITERATIONS_EXCEEDED");
      expect(error.statusCode).toBe(400);
      expect(error.context).toEqual({ requested: 100, maximum: 50 });
    });
  });

  describe("LLMTimeoutError", () => {
    it("should create error with provider and timeout", () => {
      const error = new LLMTimeoutError("anthropic", 60000);

      expect(error.code).toBe("LLM_TIMEOUT");
      expect(error.statusCode).toBe(504);
      expect(error.context?.provider).toBe("anthropic");
      expect(error.context?.timeoutMs).toBe(60000);
    });
  });

  describe("InputValidationError", () => {
    it("should create error with message", () => {
      const error = new InputValidationError("Invalid task format");

      expect(error.code).toBe("INPUT_VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain("Invalid task format");
    });
  });

  describe("isAppError", () => {
    it("should return true for AppError instances", () => {
      const error = new WorkflowNotFoundError("test");
      expect(isAppError(error)).toBe(true);
    });

    it("should return false for regular Error", () => {
      const error = new Error("test");
      expect(isAppError(error)).toBe(false);
    });

    it("should return false for non-errors", () => {
      expect(isAppError("string")).toBe(false);
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
      expect(isAppError({})).toBe(false);
    });
  });
});
