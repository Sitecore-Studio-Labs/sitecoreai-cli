import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpRegistry } from "../../../src/mcp/registry";
import type { McpContext, McpContextProvider } from "../../../src/mcp/auth";

/**
 * `buildMcpServer` / `startStdioTransport` — the thin bridge that walks
 * an `McpRegistry` and forwards each tool / resource / prompt to the
 * MCP SDK's `McpServer`.
 *
 * `dispatchTool` is mocked so the forwarder is observable in isolation:
 * the test asserts the tool forwarder resolves `getContext` lazily and
 * threads the bound context + a built `ToolExtra` (signal + progress
 * sender) into the dispatcher. A real SDK `Client` over an in-memory
 * transport drives the round-trips end to end.
 */

const dispatchMock = vi.hoisted(() => ({ dispatchTool: vi.fn() }));
vi.mock("../../../src/mcp/dispatch", () => dispatchMock);

import { buildMcpServer, startStdioTransport } from "../../../src/mcp/server";

const minDescription = "X".padEnd(60, "x");
const validAnnotations = {
  title: "Demo tool",
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const boundContext = { envName: "sandbox" } as unknown as McpContext;

/** A registry with one tool, one resource, one prompt. */
const buildRegistry = (): {
  registry: McpRegistry;
  resourceHandler: ReturnType<typeof vi.fn>;
  promptHandler: ReturnType<typeof vi.fn>;
} => {
  const registry = new McpRegistry();
  const resourceHandler = vi.fn().mockResolvedValue({
    contents: [{ uri: "scai://help/demo", mimeType: "text/markdown", text: "help body" }],
  });
  const promptHandler = vi.fn().mockResolvedValue({
    messages: [{ role: "user", content: { type: "text", text: "do it" } }],
  });
  registry.registerTool({
    name: "demo_tool",
    description: minDescription,
    auth: "read",
    annotations: validAnnotations,
    inputSchema: { value: z.string() },
    handler: async () => ({ content: [{ type: "text", text: "unused" }] }),
  });
  registry.registerResource({
    uri: "scai://help/demo",
    name: "demo-resource",
    description: "Demo resource",
    mimeType: "text/markdown",
    handler: resourceHandler,
  });
  registry.registerPrompt({
    name: "demo.prompt",
    description: "Demo prompt",
    argsSchema: { topic: z.string() },
    handler: promptHandler,
  });
  return { registry, resourceHandler, promptHandler };
};

/** Connect a real SDK Client to the built server over an in-memory pair. */
const connectClient = async (
  getContext: McpContextProvider,
  registry: McpRegistry
): Promise<{ client: Client; close: () => Promise<void> }> => {
  const server = buildMcpServer({ getContext, registry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "scai-server-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

beforeEach(() => {
  dispatchMock.dispatchTool.mockReset();
  dispatchMock.dispatchTool.mockResolvedValue({ content: [{ type: "text", text: "dispatched" }] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildMcpServer — registration surface", () => {
  it("returns an McpServer that lists every registered tool / resource / prompt", async () => {
    const { registry } = buildRegistry();
    const { client, close } = await connectClient(async () => boundContext, registry);
    try {
      const { tools } = await client.listTools();
      const { resources } = await client.listResources();
      const { prompts } = await client.listPrompts();
      expect(tools.map((t) => t.name)).toEqual(["demo_tool"]);
      expect(resources.map((r) => r.uri)).toEqual(["scai://help/demo"]);
      expect(prompts.map((p) => p.name)).toEqual(["demo.prompt"]);
    } finally {
      await close();
    }
  });

  it("propagates the tool annotations + description to the SDK metadata", async () => {
    const { registry } = buildRegistry();
    const { client, close } = await connectClient(async () => boundContext, registry);
    try {
      const { tools } = await client.listTools();
      expect(tools[0].description).toBe(minDescription);
      expect(tools[0].annotations?.title).toBe("Demo tool");
    } finally {
      await close();
    }
  });
});

describe("buildMcpServer — tool forwarder", () => {
  it("resolves getContext lazily (not during build, only on first call)", async () => {
    const { registry } = buildRegistry();
    const getContext = vi.fn<McpContextProvider>().mockResolvedValue(boundContext);
    const { client, close } = await connectClient(getContext, registry);
    try {
      // Build + handshake + listTools must not touch the context.
      await client.listTools();
      expect(getContext).not.toHaveBeenCalled();

      await client.callTool({ name: "demo_tool", arguments: { value: "hi" } });
      expect(getContext).toHaveBeenCalledOnce();
    } finally {
      await close();
    }
  });

  it("delegates a tool call to dispatchTool with the bound context + a built ToolExtra", async () => {
    const { registry } = buildRegistry();
    const { client, close } = await connectClient(async () => boundContext, registry);
    try {
      await client.callTool({ name: "demo_tool", arguments: { value: "payload" } });
      expect(dispatchMock.dispatchTool).toHaveBeenCalledOnce();
      const [descriptor, args, options] = dispatchMock.dispatchTool.mock.calls[0];
      expect(descriptor.name).toBe("demo_tool");
      expect(args).toEqual({ value: "payload" });
      expect(options.context).toBe(boundContext);
      expect(options.extra.signal).toBeInstanceOf(AbortSignal);
      expect(typeof options.extra.sendProgress).toBe("function");
      expect(typeof options.extra.sendNotification).toBe("function");
    } finally {
      await close();
    }
  });

  it("returns the dispatcher's CallToolResult to the SDK client", async () => {
    const { registry } = buildRegistry();
    dispatchMock.dispatchTool.mockResolvedValue({
      content: [{ type: "text", text: "from-dispatch" }],
    });
    const { client, close } = await connectClient(async () => boundContext, registry);
    try {
      const result = await client.callTool({ name: "demo_tool", arguments: { value: "x" } });
      expect(result.content).toEqual([{ type: "text", text: "from-dispatch" }]);
    } finally {
      await close();
    }
  });

  it("sendProgress is a no-op when the client supplied no progress token", async () => {
    const { registry } = buildRegistry();
    const { client, close } = await connectClient(async () => boundContext, registry);
    try {
      await client.callTool({ name: "demo_tool", arguments: { value: "x" } });
      const { extra } = dispatchMock.dispatchTool.mock.calls[0][2];
      // No token → resolves without throwing and emits nothing.
      await expect(extra.sendProgress(1, 2, "tick")).resolves.toBeUndefined();
    } finally {
      await close();
    }
  });

  it("sendProgress emits a notifications/progress frame when the client supplied a token", async () => {
    const { registry } = buildRegistry();
    // The dispatcher mock drives a progress emission mid-call so the
    // SDK's onprogress callback sees a real notification frame.
    dispatchMock.dispatchTool.mockImplementation(async (_d, _a, options) => {
      await options.extra.sendProgress(1, 4, "halfway");
      return { content: [{ type: "text", text: "done" }] };
    });
    const { client, close } = await connectClient(async () => boundContext, registry);
    const onprogress = vi.fn();
    try {
      await client.callTool({ name: "demo_tool", arguments: { value: "x" } }, undefined, {
        onprogress,
      });
      expect(onprogress).toHaveBeenCalledWith(
        expect.objectContaining({ progress: 1, total: 4, message: "halfway" })
      );
    } finally {
      await close();
    }
  });

  it("swallows a failed progress notification and traces it to stderr", async () => {
    const { registry } = buildRegistry();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // A token is present (the SDK sets one because onprogress is given),
    // but the underlying transport send is forced to reject. sendProgress
    // must still resolve (progress is advisory) and trace to stderr.
    dispatchMock.dispatchTool.mockImplementation(async (_d, _a, options) => {
      await options.extra.sendProgress(2, 4, "tick");
      return { content: [{ type: "text", text: "done" }] };
    });
    const server = buildMcpServer({ getContext: async () => boundContext, registry });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    // After connect, sabotage the server transport's send so the
    // progress-notification frame rejects.
    const realSend = serverTransport.send.bind(serverTransport);
    serverTransport.send = vi.fn((message: unknown) => {
      const method = (message as { method?: string }).method;
      if (method === "notifications/progress") {
        return Promise.reject(new Error("transport closed"));
      }
      return realSend(message as never);
    });
    const client = new Client({ name: "scai-server-test", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      await client.callTool({ name: "demo_tool", arguments: { value: "x" } }, undefined, {
        onprogress: vi.fn(),
      });
      const traced = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(traced).toContain("progress notification dropped");
      expect(traced).toContain("transport closed");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("buildMcpServer — resource + prompt forwarders", () => {
  it("forwards a resource read to the descriptor handler with the resolved context", async () => {
    const { registry, resourceHandler } = buildRegistry();
    const { client, close } = await connectClient(async () => boundContext, registry);
    try {
      const result = await client.readResource({ uri: "scai://help/demo" });
      expect(result.contents[0].text).toBe("help body");
      expect(resourceHandler).toHaveBeenCalledWith(boundContext);
    } finally {
      await close();
    }
  });

  it("forwards prompt args + the resolved context to the prompt handler", async () => {
    const { registry, promptHandler } = buildRegistry();
    const { client, close } = await connectClient(async () => boundContext, registry);
    try {
      const result = await client.getPrompt({
        name: "demo.prompt",
        arguments: { topic: "recipes" },
      });
      expect(result.messages[0].content).toMatchObject({ type: "text", text: "do it" });
      expect(promptHandler).toHaveBeenCalledWith({ topic: "recipes" }, boundContext);
    } finally {
      await close();
    }
  });
});

describe("startStdioTransport", () => {
  it("connects the server to a stdio transport", async () => {
    const { registry } = buildRegistry();
    const server = buildMcpServer({ getContext: async () => boundContext, registry });
    const connectSpy = vi.spyOn(server, "connect").mockResolvedValue(undefined);

    await startStdioTransport(server);

    expect(connectSpy).toHaveBeenCalledOnce();
    // The transport handed to connect is the SDK's StdioServerTransport.
    expect(connectSpy.mock.calls[0][0]).toBeDefined();
  });
});
