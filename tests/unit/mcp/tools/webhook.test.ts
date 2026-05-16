import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const taskMocks = vi.hoisted(() => ({
  runWebhookList: vi.fn().mockResolvedValue({
    rootPath: "/sitecore/system/Webhooks",
    handlers: [
      { itemId: "h1", name: "X", path: "/sitecore/system/Webhooks/X", templateName: null },
    ],
  }),
  runWebhookInspect: vi.fn().mockResolvedValue({
    itemId: "h1",
    name: "X",
    path: "/sitecore/system/Webhooks/X",
    templateName: "Webhook Event Handler",
    fields: {
      url: "https://x",
      enabled: true,
      eventsRaw: null,
      events: [],
      authorizationItemId: null,
      serializationType: "JSON",
      description: null,
    },
  }),
  runWebhookCreate: vi.fn().mockResolvedValue({
    status: "created",
    handler: { itemId: "h1", name: "X", path: "/sitecore/system/Webhooks/X", templateName: null },
    plan: {
      flavor: "item",
      name: "X",
      url: "https://x",
      events: ["item:saved"],
      parent: "/sitecore/system/Webhooks",
    },
  }),
  runWebhookDelete: vi.fn().mockResolvedValue({ status: "deleted", webhook: "/x" }),
  runWebhookEventTypes: vi.fn().mockResolvedValue({
    eventTypes: [
      {
        itemId: "e1",
        name: "item:saved",
        category: "item",
        path: "/sitecore/system/Settings/Webhooks/Event Types/Item/item:saved",
      },
      {
        itemId: "e2",
        name: "publish:end",
        category: "publish",
        path: "/sitecore/system/Settings/Webhooks/Event Types/Publish/publish:end",
      },
    ],
  }),
}));

vi.mock("../../../../src/webhooks/tasks/list", () => ({
  runWebhookList: taskMocks.runWebhookList,
}));
vi.mock("../../../../src/webhooks/tasks/inspect", () => ({
  runWebhookInspect: taskMocks.runWebhookInspect,
}));
vi.mock("../../../../src/webhooks/tasks/create", () => ({
  runWebhookCreate: taskMocks.runWebhookCreate,
}));
vi.mock("../../../../src/webhooks/tasks/delete", () => ({
  runWebhookDelete: taskMocks.runWebhookDelete,
}));
vi.mock("../../../../src/webhooks/tasks/event-types", () => ({
  runWebhookEventTypes: taskMocks.runWebhookEventTypes,
}));

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
  deployToken: "tok",
};

const fakeExtra = {
  signal: new AbortController().signal,
  progressToken: undefined,
  sendProgress: async () => undefined,
  sendNotification: async () => undefined,
};

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

describe("webhook_inspect tool", () => {
  it("registers with read auth + readOnlyHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("webhook_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("routes verb='list' with optional event-type filter", async () => {
    const reg = await setup();
    await reg
      .getTool("webhook_inspect")!
      .handler({ verb: "list", eventType: "publish", enabledOnly: true }, fakeContext, fakeExtra);
    expect(taskMocks.runWebhookList).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "publish", enabledOnly: true })
    );
  });

  it("requires `webhook` for verb='get'", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("webhook_inspect")!.handler({ verb: "get" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("routes verb='event-types' without requiring extra inputs", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("webhook_inspect")!
      .handler({ verb: "event-types" }, fakeContext, fakeExtra);
    expect(taskMocks.runWebhookEventTypes).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "test-env" })
    );
    expect(result.structuredContent).toMatchObject({
      verb: "event-types",
      result: { eventTypes: expect.any(Array) },
    });
  });

  it("forwards the category filter on verb='event-types'", async () => {
    const reg = await setup();
    await reg
      .getTool("webhook_inspect")!
      .handler({ verb: "event-types", category: "publish" }, fakeContext, fakeExtra);
    expect(taskMocks.runWebhookEventTypes).toHaveBeenCalledWith(
      expect.objectContaining({ category: "publish" })
    );
  });
});

describe("webhook_manage tool", () => {
  it("registers with write auth + destructiveHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("webhook_manage")!;
    expect(tool.auth).toBe("write");
    expect(tool.annotations.destructiveHint).toBe(true);
  });

  it("requires name+url+event for verb='create'", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("webhook_manage")!
        .handler({ verb: "create", name: "X" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("dispatches verb='create' with event-type flavor + allowWrite", async () => {
    const reg = await setup();
    await reg.getTool("webhook_manage")!.handler(
      {
        verb: "create",
        name: "X",
        url: "https://x",
        event: "item",
        events: ["item:saved"],
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(taskMocks.runWebhookCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "X",
        url: "https://x",
        event: "item",
        events: ["item:saved"],
        allowWrite: true,
      })
    );
  });

  it("requires `webhook` for verb='delete'", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("webhook_manage")!.handler({ verb: "delete" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("dispatches verb='delete' with allowWrite", async () => {
    const reg = await setup();
    await reg
      .getTool("webhook_manage")!
      .handler(
        { verb: "delete", webhook: "/sitecore/system/Webhooks/X", allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(taskMocks.runWebhookDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: "/sitecore/system/Webhooks/X",
        allowWrite: true,
      })
    );
  });
});
