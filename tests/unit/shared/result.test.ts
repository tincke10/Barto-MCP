import { describe, it, expect } from "vitest";
import { Result } from "@/shared/types/index.js";

describe("Result", () => {
  describe("ok", () => {
    it("should create a successful result", () => {
      const result = Result.ok(42);

      expect(result.success).toBe(true);
      expect(Result.isOk(result)).toBe(true);
      expect(Result.isErr(result)).toBe(false);
      if (result.success) {
        expect(result.data).toBe(42);
      }
    });
  });

  describe("err", () => {
    it("should create a failed result", () => {
      const error = new Error("test error");
      const result = Result.err(error);

      expect(result.success).toBe(false);
      expect(Result.isOk(result)).toBe(false);
      expect(Result.isErr(result)).toBe(true);
      if (!result.success) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe("map", () => {
    it("should transform successful result", () => {
      const result = Result.ok(5);
      const mapped = Result.map(result, (x) => x * 2);

      expect(mapped.success).toBe(true);
      if (mapped.success) {
        expect(mapped.data).toBe(10);
      }
    });

    it("should pass through failed result", () => {
      const error = new Error("test");
      const result = Result.err(error);
      const mapped = Result.map(result, (x: number) => x * 2);

      expect(mapped.success).toBe(false);
      if (!mapped.success) {
        expect(mapped.error).toBe(error);
      }
    });
  });

  describe("flatMap", () => {
    it("should chain successful results", () => {
      const result = Result.ok(5);
      const chained = Result.flatMap(result, (x) => Result.ok(x * 2));

      expect(chained.success).toBe(true);
      if (chained.success) {
        expect(chained.data).toBe(10);
      }
    });

    it("should short-circuit on error", () => {
      const error = new Error("test");
      const result = Result.err(error);
      const chained = Result.flatMap(result, (x: number) => Result.ok(x * 2));

      expect(chained.success).toBe(false);
    });
  });

  describe("unwrap", () => {
    it("should return data for successful result", () => {
      const result = Result.ok(42);
      expect(Result.unwrap(result)).toBe(42);
    });

    it("should throw for failed result", () => {
      const error = new Error("test error");
      const result = Result.err(error);
      expect(() => Result.unwrap(result)).toThrow(error);
    });
  });

  describe("unwrapOr", () => {
    it("should return data for successful result", () => {
      const result = Result.ok(42);
      expect(Result.unwrapOr(result, 0)).toBe(42);
    });

    it("should return default for failed result", () => {
      const result = Result.err(new Error("test"));
      expect(Result.unwrapOr(result, 0)).toBe(0);
    });
  });

  describe("fromPromise", () => {
    it("should create ok result from resolved promise", async () => {
      const result = await Result.fromPromise(Promise.resolve(42));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(42);
      }
    });

    it("should create err result from rejected promise", async () => {
      const error = new Error("test error");
      const result = await Result.fromPromise(Promise.reject(error));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("test error");
      }
    });
  });
});
