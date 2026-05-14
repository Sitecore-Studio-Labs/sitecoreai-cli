import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dispatchTool, __resetDispatchMutexForTests } from "../../../src/mcp/dispatch";
import type { McpContext } from "../../../src/mcp/auth";
import type { ToolDescriptor } from "../../../src/mcp/registry";

const baseContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: {} as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "dummy",
};

const baseAnnotations = {
  title: "test",
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const minDescription = "X".padEnd(60, "x");

afterEach(() => __resetDispatchMutexForTests());

describe("dispatchTool — allowWrite gate", () => {
  it("rejects a write tool when allowWrite is not true", async () => {
    const handler = vi.fn();
    const descriptor: ToolDescriptor = {
      name: "demo_write",
      description: minDescription,
      annotations: baseAnnotations,
      auth: "write",
      inputSchema: { allowWrite: z.boolean() },
      handler,
    };
    const result = await dispatchTool(descriptor, { allowWrite: false }, { context: baseContext });
    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect((result.structuredContent as { code: string }).code).toBe("INPUT_INVALID");
  });

  it("invokes the handler when allowWrite is true", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "wrote" }] }));
    const descriptor: ToolDescriptor = {
      name: "demo_write",
      description: minDescription,
      annotations: baseAnnotations,
      auth: "write",
      inputSchema: { allowWrite: z.boolean() },
      handler,
    };
    const result = await dispatchTool(descriptor, { allowWrite: true }, { context: baseContext });
    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("calls read tools without gating", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "read" }] }));
    const descriptor: ToolDescriptor = {
      name: "demo_read",
      description: minDescription,
      annotations: baseAnnotations,
      auth: "read",
      inputSchema: {},
      handler,
    };
    const result = await dispatchTool(descriptor, {}, { context: baseContext });
    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("dispatchTool — error envelope", () => {
  it("wraps thrown errors in the typed envelope", async () => {
    const descriptor: ToolDescriptor = {
      name: "demo_throws",
      description: minDescription,
      annotations: baseAnnotations,
      auth: "read",
      inputSchema: {},
      handler: async () => {
        throw new Error("boom");
      },
    };
    const result = await dispatchTool(descriptor, {}, { context: baseContext });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      code: string;
      what: string;
      why: string;
      next: string;
    };
    expect(structured.code).toBe("UNKNOWN");
    expect(structured.why).toContain("boom");
    expect(typeof structured.next).toBe("string");
  });
});

describe("dispatchTool — mutex", () => {
  it("serializes concurrent calls so handlers do not overlap", async () => {
    const inFlight: string[] = [];
    const overlaps: string[] = [];
    let counter = 0;
    const makeDescriptor = (name: string): ToolDescriptor => ({
      name,
      description: minDescription,
      annotations: baseAnnotations,
      auth: "read",
      inputSchema: {},
      handler: async () => {
        const id = `${name}-${counter++}`;
        inFlight.push(id);
        if (inFlight.length > 1) {
          overlaps.push(id);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight.splice(inFlight.indexOf(id), 1);
        return { content: [{ type: "text" as const, text: id }] };
      },
    });
    const a = dispatchTool(makeDescriptor("a"), {}, { context: baseContext });
    const b = dispatchTool(makeDescriptor("b"), {}, { context: baseContext });
    const c = dispatchTool(makeDescriptor("c"), {}, { context: baseContext });
    await Promise.all([a, b, c]);
    expect(overlaps).toHaveLength(0);
  });

  it("does not wedge dispatch when a handler rejects", async () => {
    const failing: ToolDescriptor = {
      name: "demo_fail",
      description: minDescription,
      annotations: baseAnnotations,
      auth: "read",
      inputSchema: {},
      handler: async () => {
        throw new Error("fail");
      },
    };
    const succeeding: ToolDescriptor = {
      ...failing,
      name: "demo_ok",
      handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    };
    const first = await dispatchTool(failing, {}, { context: baseContext });
    expect(first.isError).toBe(true);
    const second = await dispatchTool(succeeding, {}, { context: baseContext });
    expect(second.isError).toBeUndefined();
  });
});
