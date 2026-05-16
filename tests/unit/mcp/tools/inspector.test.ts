import { describe, expect, it } from "vitest";
import { buildScaiMcpRegistry } from "../../../../src/mcp/build-registry";
import type { McpContext } from "../../../../src/mcp/auth";

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: {} as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "x",
};

describe("inspector tools", () => {
  const registry = buildScaiMcpRegistry();

  it("tools_list returns the full registry", async () => {
    const tool = registry.getTool("tools_list")!;
    const result = await tool.handler({}, fakeContext);
    const tools = (result.structuredContent as { tools: Array<{ name: string }> }).tools;
    expect(tools.length).toBe(registry.listTools().length);
    expect(tools.some((t) => t.name === "scai_overview")).toBe(true);
  });

  it("tools_schema returns the JSON schema for a known tool", async () => {
    const tool = registry.getTool("tools_schema")!;
    const result = await tool.handler({ name: "recipe_push" }, fakeContext);
    const structured = result.structuredContent as {
      name: string;
      schema: { type: string; properties: Record<string, unknown> };
    };
    expect(structured.name).toBe("recipe_push");
    expect(structured.schema.type).toBe("object");
    expect(structured.schema.properties).toHaveProperty("allowWrite");
    expect(structured.schema.properties).toHaveProperty("inputPath");
  });

  it("tools_schema returns an error envelope for an unknown tool", async () => {
    const tool = registry.getTool("tools_schema")!;
    const result = await tool.handler({ name: "does_not_exist" }, fakeContext);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INPUT_INVALID");
  });

  it("tools_schema with no name returns every tool's schema", async () => {
    const tool = registry.getTool("tools_schema")!;
    const result = await tool.handler({}, fakeContext);
    const schemas = (result.structuredContent as { schemas: Array<{ name: string }> }).schemas;
    expect(schemas.length).toBe(registry.listTools().length);
  });
});
