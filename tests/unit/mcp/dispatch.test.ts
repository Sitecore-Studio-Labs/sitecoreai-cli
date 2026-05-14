import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dispatchTool, __resetDispatchLockForTests } from "../../../src/mcp/dispatch";
import type { McpContext } from "../../../src/mcp/auth";
import type { ToolDescriptor, ToolExtra } from "../../../src/mcp/registry";

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

export const makeExtra = (overrides: Partial<ToolExtra> = {}): ToolExtra => ({
  signal: overrides.signal ?? new AbortController().signal,
  progressToken: overrides.progressToken,
  sendProgress: overrides.sendProgress ?? (async () => undefined),
  sendNotification: overrides.sendNotification ?? (async () => undefined),
});

afterEach(() => __resetDispatchLockForTests());

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
    const result = await dispatchTool(
      descriptor,
      { allowWrite: false },
      { context: baseContext, extra: makeExtra() }
    );
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
    const result = await dispatchTool(
      descriptor,
      { allowWrite: true },
      { context: baseContext, extra: makeExtra() }
    );
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
    const result = await dispatchTool(descriptor, {}, { context: baseContext, extra: makeExtra() });
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
    const result = await dispatchTool(descriptor, {}, { context: baseContext, extra: makeExtra() });
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

describe("dispatchTool — cancellation", () => {
  it("returns a CANCELLED envelope when the signal is already aborted at dispatch time", async () => {
    const handler = vi.fn();
    const descriptor: ToolDescriptor = {
      name: "demo_read",
      description: minDescription,
      annotations: baseAnnotations,
      auth: "read",
      inputSchema: {},
      handler,
    };
    const aborter = new AbortController();
    aborter.abort();
    const result = await dispatchTool(
      descriptor,
      {},
      { context: baseContext, extra: makeExtra({ signal: aborter.signal }) }
    );
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("CANCELLED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("converts a mid-flight abort into a CANCELLED envelope", async () => {
    const aborter = new AbortController();
    const descriptor: ToolDescriptor = {
      name: "demo_long",
      description: minDescription,
      annotations: baseAnnotations,
      auth: "read",
      inputSchema: {},
      handler: async () => {
        aborter.abort();
        return { content: [{ type: "text" as const, text: "fake-success" }] };
      },
    };
    const result = await dispatchTool(
      descriptor,
      {},
      { context: baseContext, extra: makeExtra({ signal: aborter.signal }) }
    );
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("CANCELLED");
  });
});

describe("dispatchTool — read/write lock", () => {
  type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
  const defer = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  const makeDescriptor = (
    name: string,
    auth: "read" | "write",
    handler: ToolDescriptor["handler"]
  ): ToolDescriptor => ({
    name,
    description: minDescription,
    annotations: baseAnnotations,
    auth,
    inputSchema: auth === "write" ? { allowWrite: z.boolean() } : {},
    handler,
  });

  it("runs concurrent read tools in parallel", async () => {
    const gate = defer<void>();
    let peakInFlight = 0;
    let inFlight = 0;
    const handler: ToolDescriptor["handler"] = async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await gate.promise;
      inFlight -= 1;
      return { content: [{ type: "text" as const, text: "ok" }] };
    };
    const a = dispatchTool(makeDescriptor("read_a", "read", handler), {}, {
      context: baseContext,
      extra: makeExtra(),
    });
    const b = dispatchTool(makeDescriptor("read_b", "read", handler), {}, {
      context: baseContext,
      extra: makeExtra(),
    });
    const c = dispatchTool(makeDescriptor("read_c", "read", handler), {}, {
      context: baseContext,
      extra: makeExtra(),
    });
    // Yield enough microtasks for all three reads to acquire the lock.
    await new Promise((r) => setTimeout(r, 5));
    expect(peakInFlight).toBe(3);
    gate.resolve();
    await Promise.all([a, b, c]);
  });

  it("makes writes exclusive against reads", async () => {
    const readGate = defer<void>();
    const events: string[] = [];
    const readHandler: ToolDescriptor["handler"] = async () => {
      events.push("read-start");
      await readGate.promise;
      events.push("read-end");
      return { content: [{ type: "text" as const, text: "r" }] };
    };
    const writeHandler: ToolDescriptor["handler"] = async () => {
      events.push("write-start");
      events.push("write-end");
      return { content: [{ type: "text" as const, text: "w" }] };
    };
    const r = dispatchTool(makeDescriptor("read_a", "read", readHandler), {}, {
      context: baseContext,
      extra: makeExtra(),
    });
    // Give the read a tick to acquire the lock before the write queues.
    await new Promise((res) => setTimeout(res, 0));
    const w = dispatchTool(
      makeDescriptor("write_a", "write", writeHandler),
      { allowWrite: true },
      { context: baseContext, extra: makeExtra() }
    );
    // Brief delay — write must NOT have started yet.
    await new Promise((res) => setTimeout(res, 5));
    expect(events).toEqual(["read-start"]);
    readGate.resolve();
    await Promise.all([r, w]);
    expect(events).toEqual(["read-start", "read-end", "write-start", "write-end"]);
  });

  it("serializes writes against writes", async () => {
    const gateA = defer<void>();
    let aRunning = false;
    let bRunning = false;
    let overlap = false;
    const w1: ToolDescriptor["handler"] = async () => {
      aRunning = true;
      if (bRunning) overlap = true;
      await gateA.promise;
      aRunning = false;
      return { content: [{ type: "text" as const, text: "w1" }] };
    };
    const w2: ToolDescriptor["handler"] = async () => {
      bRunning = true;
      if (aRunning) overlap = true;
      bRunning = false;
      return { content: [{ type: "text" as const, text: "w2" }] };
    };
    const a = dispatchTool(
      makeDescriptor("w1", "write", w1),
      { allowWrite: true },
      { context: baseContext, extra: makeExtra() }
    );
    const b = dispatchTool(
      makeDescriptor("w2", "write", w2),
      { allowWrite: true },
      { context: baseContext, extra: makeExtra() }
    );
    await new Promise((res) => setTimeout(res, 5));
    expect(bRunning).toBe(false);
    gateA.resolve();
    await Promise.all([a, b]);
    expect(overlap).toBe(false);
  });

  it("admits a queued write before queued readers (writer preference)", async () => {
    const firstReadGate = defer<void>();
    const order: string[] = [];
    const firstRead: ToolDescriptor["handler"] = async () => {
      order.push("read-1");
      await firstReadGate.promise;
      return { content: [{ type: "text" as const, text: "r1" }] };
    };
    const write: ToolDescriptor["handler"] = async () => {
      order.push("write");
      return { content: [{ type: "text" as const, text: "w" }] };
    };
    const secondRead: ToolDescriptor["handler"] = async () => {
      order.push("read-2");
      return { content: [{ type: "text" as const, text: "r2" }] };
    };

    // Read 1 grabs the lock and parks.
    const r1 = dispatchTool(makeDescriptor("r1", "read", firstRead), {}, {
      context: baseContext,
      extra: makeExtra(),
    });
    await new Promise((res) => setTimeout(res, 0));
    // Write queues behind it.
    const w = dispatchTool(
      makeDescriptor("w", "write", write),
      { allowWrite: true },
      { context: baseContext, extra: makeExtra() }
    );
    await new Promise((res) => setTimeout(res, 0));
    // Read 2 must queue behind the waiting write, not slip in alongside r1.
    const r2 = dispatchTool(makeDescriptor("r2", "read", secondRead), {}, {
      context: baseContext,
      extra: makeExtra(),
    });
    await new Promise((res) => setTimeout(res, 5));
    expect(order).toEqual(["read-1"]);
    firstReadGate.resolve();
    await Promise.all([r1, w, r2]);
    expect(order).toEqual(["read-1", "write", "read-2"]);
  });

  it("does not wedge dispatch when a handler rejects", async () => {
    const failing: ToolDescriptor = makeDescriptor("demo_fail", "read", async () => {
      throw new Error("fail");
    });
    const succeeding: ToolDescriptor = makeDescriptor("demo_ok", "read", async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const first = await dispatchTool(failing, {}, { context: baseContext, extra: makeExtra() });
    expect(first.isError).toBe(true);
    const second = await dispatchTool(succeeding, {}, { context: baseContext, extra: makeExtra() });
    expect(second.isError).toBeUndefined();
  });
});
