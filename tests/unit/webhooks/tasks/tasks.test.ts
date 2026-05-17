import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWebhookList } from "../../../../src/webhooks/tasks/list";
import { runWebhookInspect } from "../../../../src/webhooks/tasks/inspect";
import { runWebhookCreate } from "../../../../src/webhooks/tasks/create";
import { runWebhookDelete } from "../../../../src/webhooks/tasks/delete";
import { runWebhookEventTypes } from "../../../../src/webhooks/tasks/event-types";
import * as sharedModule from "../../../../src/webhooks/tasks/shared";
import * as allowWriteModule from "../../../../src/policy/allow-write";
import type { WebhookApiClient } from "../../../../src/webhooks/api/client";

vi.mock("../../../../src/webhooks/tasks/shared", async () => {
  const actual = await vi.importActual<typeof sharedModule>(
    "../../../../src/webhooks/tasks/shared"
  );
  return { ...actual, resolveWebhookTenant: vi.fn() };
});

vi.mock("../../../../src/policy/allow-write", async () => {
  const actual = await vi.importActual<typeof allowWriteModule>(
    "../../../../src/policy/allow-write"
  );
  return { ...actual, ensureAllowWrite: vi.fn() };
});

const stubClient = (overrides: Partial<WebhookApiClient> = {}): WebhookApiClient => ({
  listEventHandlers: vi.fn().mockResolvedValue([]),
  getEventHandler: vi.fn().mockResolvedValue(null),
  createEventHandler: vi.fn(),
  createWorkflowSubmitAction: vi.fn(),
  createWorkflowValidationAction: vi.fn(),
  deleteWebhookItem: vi.fn().mockResolvedValue(undefined),
  listEventTypes: vi.fn().mockResolvedValue([]),
  templates: {} as never,
  ...overrides,
});

const installClient = (client: WebhookApiClient): void => {
  vi.mocked(sharedModule.resolveWebhookTenant).mockReturnValue({
    envName: "test",
    environment: {} as never,
    root: { environments: {} } as never,
    client,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWebhookList", () => {
  it("filters by event-type category (publish vs workflow vs item)", async () => {
    const handlers = [
      { itemId: "h1", name: "Item", path: "/x/h1", templateName: "Webhook Event Handler" },
      { itemId: "h2", name: "Wf", path: "/x/h2", templateName: "Webhook Submit Action" },
    ];
    const client = stubClient({ listEventHandlers: vi.fn().mockResolvedValue(handlers) });
    installClient(client);

    const result = await runWebhookList({ eventType: "workflow", json: true });

    expect(result.handlers.map((h) => h.itemId)).toEqual(["h2"]);
  });

  it("respects --root override", async () => {
    const client = stubClient();
    installClient(client);

    await runWebhookList({ root: "/sitecore/system/Workflows/Sample/Draft", json: true });

    expect(client.listEventHandlers).toHaveBeenCalledWith({
      rootPath: "/sitecore/system/Workflows/Sample/Draft",
    });
  });
});

describe("runWebhookEventTypes", () => {
  it("returns the full catalog when no category is provided", async () => {
    const eventTypes = [
      {
        itemId: "e1",
        name: "item:saved",
        category: "item" as const,
        path: "/sitecore/system/Settings/Webhooks/Event Types/Item/item:saved",
      },
      {
        itemId: "e2",
        name: "publish:end",
        category: "publish" as const,
        path: "/sitecore/system/Settings/Webhooks/Event Types/Publish/publish:end",
      },
    ];
    const listEventTypes = vi.fn().mockResolvedValue(eventTypes);
    const client = stubClient({ listEventTypes });
    installClient(client);

    const result = await runWebhookEventTypes({ json: true });

    expect(result.eventTypes).toEqual(eventTypes);
    expect(listEventTypes).toHaveBeenCalledWith(undefined);
  });

  it("forwards the category filter to the client", async () => {
    const listEventTypes = vi.fn().mockResolvedValue([]);
    const client = stubClient({ listEventTypes });
    installClient(client);

    await runWebhookEventTypes({ category: "publish", json: true });

    expect(listEventTypes).toHaveBeenCalledWith({ category: "publish" });
  });
});

describe("runWebhookInspect", () => {
  it("returns null when the webhook isn't found", async () => {
    const client = stubClient({ getEventHandler: vi.fn().mockResolvedValue(null) });
    installClient(client);

    const result = await runWebhookInspect({
      webhook: "/sitecore/system/Webhooks/Missing",
      json: true,
    });

    expect(result).toBeNull();
  });

  it("looks up by path when given a /sitecore/... reference", async () => {
    const detail = {
      itemId: "h1",
      name: "X",
      path: "/sitecore/system/Webhooks/X",
      templateName: "Webhook Event Handler",
      fields: {
        description: null,
        url: "https://x",
        eventsRaw: null,
        events: [],
        enabled: true,
        authorizationItemId: null,
        serializationType: "JSON",
      },
    };
    const client = stubClient({ getEventHandler: vi.fn().mockResolvedValue(detail) });
    installClient(client);

    await runWebhookInspect({ webhook: "/sitecore/system/Webhooks/X", json: true });

    expect(client.getEventHandler).toHaveBeenCalledWith({
      path: "/sitecore/system/Webhooks/X",
    });
  });
});

describe("runWebhookCreate — input validation", () => {
  it("throws on missing --name", async () => {
    installClient(stubClient());
    await expect(
      runWebhookCreate({
        name: "",
        url: "https://x",
        event: "item",
        events: ["item:saved"],
        json: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws on missing --url", async () => {
    installClient(stubClient());
    await expect(
      runWebhookCreate({
        name: "n",
        url: "",
        event: "item",
        events: ["item:saved"],
        json: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws when item flavor has no events", async () => {
    installClient(stubClient());
    await expect(
      runWebhookCreate({
        name: "n",
        url: "https://x",
        event: "item",
        events: [],
        allowWrite: true,
        json: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects event names that don't match the chosen category", async () => {
    installClient(stubClient());
    await expect(
      runWebhookCreate({
        name: "n",
        url: "https://x",
        event: "publish",
        events: ["item:saved"],
        allowWrite: true,
        json: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws when workflow flavor has no --on-state", async () => {
    installClient(stubClient());
    await expect(
      runWebhookCreate({
        name: "n",
        url: "https://x",
        event: "workflow",
        allowWrite: true,
        json: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("runWebhookCreate — dispatch", () => {
  it("dispatches createEventHandler for item flavor", async () => {
    const client = stubClient({
      createEventHandler: vi.fn().mockResolvedValue({
        itemId: "h1",
        name: "X",
        path: "/sitecore/system/Webhooks/X",
        templateName: "Webhook Event Handler",
      }),
    });
    installClient(client);

    const result = await runWebhookCreate({
      name: "X",
      url: "https://x",
      event: "item",
      events: ["item:saved"],
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("created");
    expect(allowWriteModule.ensureAllowWrite).toHaveBeenCalled();
    expect(client.createEventHandler).toHaveBeenCalledWith({
      name: "X",
      url: "https://x",
      events: ["item:saved"],
    });
  });

  it("dispatches createWorkflowSubmitAction for workflow/submit", async () => {
    const client = stubClient({
      createWorkflowSubmitAction: vi.fn().mockResolvedValue({
        itemId: "a1",
        name: "Notify",
        path: "/sitecore/system/Workflows/Sample/Draft/Actions/Notify",
        templateName: "Webhook Submit Action",
      }),
    });
    installClient(client);

    const result = await runWebhookCreate({
      name: "Notify",
      url: "https://x",
      event: "workflow",
      onState: "/sitecore/system/Workflows/Sample/Draft",
      action: "submit",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("created");
    expect(client.createWorkflowSubmitAction).toHaveBeenCalled();
    expect(client.createWorkflowValidationAction).not.toHaveBeenCalled();
  });

  it("dispatches createWorkflowValidationAction for workflow/validation", async () => {
    const client = stubClient({
      createWorkflowValidationAction: vi.fn().mockResolvedValue({
        itemId: "a1",
        name: "Lint",
        path: "/sitecore/system/Workflows/Sample/Submit/Actions/Lint",
        templateName: "Webhook Validation Action",
      }),
    });
    installClient(client);

    await runWebhookCreate({
      name: "Lint",
      url: "https://x",
      event: "workflow",
      onState: "/sitecore/system/Workflows/Sample/Submit",
      action: "validation",
      allowWrite: true,
      json: true,
    });

    expect(client.createWorkflowValidationAction).toHaveBeenCalled();
    expect(client.createWorkflowSubmitAction).not.toHaveBeenCalled();
  });

  it("--what-if skips both the allowWrite gate and the dispatch", async () => {
    const client = stubClient({
      createEventHandler: vi.fn(),
    });
    installClient(client);

    const result = await runWebhookCreate({
      name: "X",
      url: "https://x",
      event: "item",
      events: ["item:saved"],
      whatIf: true,
      json: true,
    });

    expect(result.status).toBe("what-if");
    expect(allowWriteModule.ensureAllowWrite).not.toHaveBeenCalled();
    expect(client.createEventHandler).not.toHaveBeenCalled();
  });
});

describe("runWebhookDelete", () => {
  it("returns not-found when no handler exists at the reference", async () => {
    const client = stubClient({ getEventHandler: vi.fn().mockResolvedValue(null) });
    installClient(client);

    const result = await runWebhookDelete({
      webhook: "/sitecore/system/Webhooks/Missing",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("not-found");
    expect(client.deleteWebhookItem).not.toHaveBeenCalled();
  });

  it("deletes by itemId after fetching the handler", async () => {
    const client = stubClient({
      getEventHandler: vi.fn().mockResolvedValue({
        itemId: "h1",
        name: "X",
        path: "/sitecore/system/Webhooks/X",
        templateName: "Webhook Event Handler",
        fields: {} as never,
      }),
    });
    installClient(client);

    const result = await runWebhookDelete({
      webhook: "/sitecore/system/Webhooks/X",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("deleted");
    expect(client.deleteWebhookItem).toHaveBeenCalledWith({ itemId: "h1" });
  });

  it("--what-if doesn't delete", async () => {
    const client = stubClient({
      getEventHandler: vi.fn().mockResolvedValue({
        itemId: "h1",
        name: "X",
        path: "/sitecore/system/Webhooks/X",
        templateName: "Webhook Event Handler",
        fields: {} as never,
      }),
    });
    installClient(client);

    const result = await runWebhookDelete({
      webhook: "/sitecore/system/Webhooks/X",
      whatIf: true,
      json: true,
    });

    expect(result.status).toBe("what-if");
    expect(allowWriteModule.ensureAllowWrite).not.toHaveBeenCalled();
    expect(client.deleteWebhookItem).not.toHaveBeenCalled();
  });
});
