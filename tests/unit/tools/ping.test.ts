import { describe, it, expect } from "vitest";
import { pingTool } from "@/tools/ping.tool.js";

describe("pingTool", () => {
  it("should have correct metadata", () => {
    expect(pingTool.name).toBe("ping");
    expect(pingTool.description).toBeDefined();
    expect(pingTool.inputSchema).toBeDefined();
  });

  it("should return pong response without message", async () => {
    const result = await pingTool.execute({}, {} as never);

    expect(result).toMatchObject({
      status: "pong",
      server: "mcp-ralph-workflow",
      version: "0.1.0",
    });
    expect((result as Record<string, unknown>).timestamp).toBeDefined();
    expect((result as Record<string, unknown>).message).toBeUndefined();
  });

  it("should echo back provided message", async () => {
    const result = await pingTool.execute({ message: "hello" }, {} as never);

    expect(result).toMatchObject({
      status: "pong",
      message: "hello",
    });
  });

  it("should handle undefined args", async () => {
    const result = await pingTool.execute(undefined, {} as never);

    expect(result).toMatchObject({
      status: "pong",
    });
  });
});
