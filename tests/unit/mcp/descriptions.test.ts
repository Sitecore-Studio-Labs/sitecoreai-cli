import { describe, expect, it } from "vitest";
import { buildScaiMcpRegistry } from "../../../src/mcp/build-registry";

describe("MCP tool descriptions + annotations", () => {
  const registry = buildScaiMcpRegistry();
  const tools = registry.listTools();

  it("registers at least 18 tools", () => {
    expect(tools.length).toBeGreaterThanOrEqual(18);
  });

  it("each tool has a description ≥50 characters", () => {
    for (const tool of tools) {
      expect(
        tool.description.length,
        `Tool '${tool.name}' description too short`
      ).toBeGreaterThanOrEqual(50);
    }
  });

  it("each tool has annotations.title + readOnlyHint + destructiveHint + openWorldHint", () => {
    for (const tool of tools) {
      expect(tool.annotations.title, `Tool '${tool.name}' is missing title`).toBeTruthy();
      expect(typeof tool.annotations.readOnlyHint, `Tool '${tool.name}' readOnlyHint`).toBe(
        "boolean"
      );
      expect(typeof tool.annotations.destructiveHint, `Tool '${tool.name}' destructiveHint`).toBe(
        "boolean"
      );
      expect(typeof tool.annotations.openWorldHint, `Tool '${tool.name}' openWorldHint`).toBe(
        "boolean"
      );
    }
  });

  it("read tools are readOnlyHint=true / destructiveHint=false", () => {
    for (const tool of tools) {
      if (tool.auth !== "read") continue;
      expect(tool.annotations.readOnlyHint, `Tool '${tool.name}' should be readOnlyHint=true`).toBe(
        true
      );
      expect(
        tool.annotations.destructiveHint,
        `Tool '${tool.name}' should be destructiveHint=false`
      ).toBe(false);
    }
  });

  it("write tools are readOnlyHint=false / destructiveHint=true", () => {
    for (const tool of tools) {
      if (tool.auth !== "write") continue;
      expect(
        tool.annotations.readOnlyHint,
        `Tool '${tool.name}' should be readOnlyHint=false`
      ).toBe(false);
      expect(
        tool.annotations.destructiveHint,
        `Tool '${tool.name}' should be destructiveHint=true`
      ).toBe(true);
    }
  });

  it("every write tool's input schema declares allowWrite", () => {
    for (const tool of tools) {
      if (tool.auth !== "write") continue;
      expect(tool.inputSchema, `Tool '${tool.name}' missing inputSchema`).toBeTruthy();
      expect(
        Object.keys(tool.inputSchema).includes("allowWrite"),
        `Tool '${tool.name}' write tool must declare allowWrite in input schema`
      ).toBe(true);
    }
  });
});
