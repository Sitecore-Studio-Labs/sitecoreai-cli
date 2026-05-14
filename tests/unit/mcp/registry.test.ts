import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpRegistry } from "../../../src/mcp/registry";

const validAnnotations = {
  title: "Test tool",
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const minDescription = "X".padEnd(60, "x");

describe("McpRegistry — registerTool", () => {
  it("registers a tool and exposes it via getTool + listTools", () => {
    const registry = new McpRegistry();
    registry.registerTool({
      name: "demo_tool",
      description: minDescription,
      auth: "read",
      annotations: validAnnotations,
      inputSchema: { value: z.string() },
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    expect(registry.getTool("demo_tool")?.name).toBe("demo_tool");
    expect(registry.listTools()).toHaveLength(1);
  });

  it("rejects duplicate tool names", () => {
    const registry = new McpRegistry();
    const descriptor = {
      name: "demo_tool",
      description: minDescription,
      auth: "read" as const,
      annotations: validAnnotations,
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    };
    registry.registerTool(descriptor);
    expect(() => registry.registerTool(descriptor)).toThrowError(/Duplicate tool registration/);
  });

  it("rejects descriptions shorter than 50 characters", () => {
    const registry = new McpRegistry();
    expect(() =>
      registry.registerTool({
        name: "demo_tool",
        description: "too short",
        auth: "read",
        annotations: validAnnotations,
        inputSchema: {},
        handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
      })
    ).toThrowError(/at least 50 characters/);
  });

  it("rejects tools missing annotations.title", () => {
    const registry = new McpRegistry();
    expect(() =>
      registry.registerTool({
        name: "demo_tool",
        description: minDescription,
        auth: "read",
        annotations: {
          ...validAnnotations,
          title: undefined as unknown as string,
        },
        inputSchema: {},
        handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
      })
    ).toThrowError(/annotations\.title/);
  });
});

describe("McpRegistry — registerResource", () => {
  it("registers a resource and rejects duplicates", () => {
    const registry = new McpRegistry();
    const descriptor = {
      uri: "scai://help/test",
      name: "test",
      description: "test",
      mimeType: "text/markdown",
      handler: async () => ({
        contents: [{ uri: "scai://help/test", mimeType: "text/markdown", text: "x" }],
      }),
    };
    registry.registerResource(descriptor);
    expect(registry.listResources()).toHaveLength(1);
    expect(() => registry.registerResource(descriptor)).toThrowError(
      /Duplicate resource registration/
    );
  });
});

describe("McpRegistry — registerPrompt", () => {
  it("registers a prompt and rejects duplicates", () => {
    const registry = new McpRegistry();
    const descriptor = {
      name: "test.prompt",
      description: "test",
      argsSchema: { recipe: z.string() },
      handler: async () => ({
        messages: [{ role: "user" as const, content: { type: "text" as const, text: "do it" } }],
      }),
    };
    registry.registerPrompt(descriptor);
    expect(registry.listPrompts()).toHaveLength(1);
    expect(() => registry.registerPrompt(descriptor)).toThrowError(/Duplicate prompt registration/);
  });
});

describe("McpRegistry — listTools ordering", () => {
  it("returns tools sorted alphabetically by name", () => {
    const registry = new McpRegistry();
    for (const name of ["zeta_tool", "alpha_tool", "beta_tool"]) {
      registry.registerTool({
        name,
        description: minDescription,
        auth: "read",
        annotations: { ...validAnnotations, title: name },
        inputSchema: {},
        handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
      });
    }
    expect(registry.listTools().map((t) => t.name)).toEqual([
      "alpha_tool",
      "beta_tool",
      "zeta_tool",
    ]);
  });
});
