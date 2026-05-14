import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../../src/config";
import { createWebhookApiClient } from "../../../../src/webhooks/api/client";

vi.mock("../../../../src/serialization/sitecore-api/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

const baseEnv: EnvironmentConfiguration = {
  name: "test",
  host: "test.sitecorecloud.io",
  database: "master",
} as EnvironmentConfiguration;

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const lastFetchBody = (
  fetchMock: ReturnType<typeof vi.fn>
): { query: string; variables?: Record<string, unknown> } =>
  JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webhook client — listEventHandlers", () => {
  it("walks children + folder recursion and filters by template name", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          data: {
            item: {
              children: {
                nodes: [
                  {
                    itemId: "h1",
                    name: "CI-Notify",
                    path: "/sitecore/system/Webhooks/CI-Notify",
                    template: { templateId: "t1", name: "Webhook Event Handler" },
                    fields: { nodes: [{ name: "Enabled", value: "1" }] },
                  },
                  {
                    itemId: "f1",
                    name: "Subfolder",
                    path: "/sitecore/system/Webhooks/Subfolder",
                    template: { templateId: "t2", name: "Folder" },
                    fields: { nodes: [] },
                  },
                  {
                    itemId: "o",
                    name: "Other",
                    path: "/sitecore/system/Webhooks/Other",
                    template: { templateId: "t3", name: "Other" },
                    fields: { nodes: [] },
                  },
                ],
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          data: {
            item: {
              children: {
                nodes: [
                  {
                    itemId: "h2",
                    name: "Nested",
                    path: "/sitecore/system/Webhooks/Subfolder/Nested",
                    template: { templateId: "t1", name: "Webhook Event Handler" },
                    fields: { nodes: [{ name: "Enabled", value: "" }] },
                  },
                ],
              },
            },
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebhookApiClient({ environment: baseEnv });
    const all = await client.listEventHandlers();

    expect(all.map((h) => h.itemId)).toEqual(["h1", "h2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("enabledOnly skips disabled handlers", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      okResponse({
        data: {
          item: {
            children: {
              nodes: [
                {
                  itemId: "h1",
                  name: "Enabled",
                  path: "/sitecore/system/Webhooks/Enabled",
                  template: { templateId: "t1", name: "Webhook Event Handler" },
                  fields: { nodes: [{ name: "Enabled", value: "1" }] },
                },
                {
                  itemId: "h2",
                  name: "Disabled",
                  path: "/sitecore/system/Webhooks/Disabled",
                  template: { templateId: "t1", name: "Webhook Event Handler" },
                  fields: { nodes: [{ name: "Enabled", value: "" }] },
                },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebhookApiClient({ environment: baseEnv });
    const enabled = await client.listEventHandlers({ enabledOnly: true });

    expect(enabled.map((h) => h.itemId)).toEqual(["h1"]);
  });
});

describe("webhook client — getEventHandler", () => {
  it("flattens fields into a friendly map", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "h1",
            name: "CI-Notify",
            path: "/sitecore/system/Webhooks/CI-Notify",
            template: { templateId: "t1", name: "Webhook Event Handler" },
            fields: {
              nodes: [
                { name: "Url", value: "https://example.com/hook" },
                { name: "Enabled", value: "1" },
                { name: "Events", value: "g-saved|g-deleted" },
                { name: "Serialization Type", value: "JSON" },
                { name: "Description", value: "CI notifier" },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebhookApiClient({ environment: baseEnv });
    const detail = await client.getEventHandler({ itemId: "h1" });

    expect(detail).not.toBeNull();
    expect(detail!.fields).toEqual({
      description: "CI notifier",
      url: "https://example.com/hook",
      eventsRaw: "g-saved|g-deleted",
      events: ["g-saved", "g-deleted"],
      enabled: true,
      authorizationItemId: null,
      serializationType: "JSON",
    });
  });
});

describe("webhook client — createEventHandler", () => {
  it("resolves template + events and dispatches createItem with the right payload", async () => {
    const fetchMock = vi
      .fn()
      // 1. resolve template
      .mockResolvedValueOnce(
        okResponse({
          data: {
            item: {
              itemId: "tmpl-handler",
              name: "Webhook Event Handler",
              path: "/sitecore/templates/System/Webhooks/Webhook Event Handler",
            },
          },
        })
      )
      // 2. resolve event item:saved
      .mockResolvedValueOnce(
        okResponse({
          data: {
            item: {
              itemId: "e-item-saved",
              name: "item:saved",
              path: "/sitecore/system/Settings/Webhooks/Event Types/Item/item:saved",
            },
          },
        })
      )
      // 3. createItem
      .mockResolvedValueOnce(
        okResponse({
          data: {
            createItem: {
              item: {
                itemId: "h-new",
                name: "CI-Notify",
                path: "/sitecore/system/Webhooks/CI-Notify",
              },
            },
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebhookApiClient({ environment: baseEnv });
    const handler = await client.createEventHandler({
      name: "CI-Notify",
      url: "https://example.com/hook",
      events: ["item:saved"],
      description: "ci",
    });

    expect(handler.path).toBe("/sitecore/system/Webhooks/CI-Notify");
    const createBody = lastFetchBody(fetchMock);
    expect(createBody.variables).toEqual({
      input: {
        templateId: "tmpl-handler",
        parent: "/sitecore/system/Webhooks",
        name: "CI-Notify",
        language: "en",
        database: "master",
        fields: [
          { name: "Url", value: "https://example.com/hook" },
          { name: "Enabled", value: "1" },
          { name: "Serialization Type", value: "JSON" },
          { name: "Description", value: "ci" },
          { name: "Events", value: "e-item-saved" },
        ],
      },
    });
  });

  it("throws INPUT_INVALID when no events are supplied", async () => {
    const client = createWebhookApiClient({ environment: baseEnv });
    await expect(
      client.createEventHandler({
        name: "x",
        url: "https://x.example.com",
        events: [],
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("webhook client — createWorkflowSubmitAction", () => {
  it("creates the action under <state>/Actions with the submit template", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          data: {
            item: {
              itemId: "tmpl-submit",
              name: "Webhook Submit Action",
              path: "/sitecore/templates/System/Workflow/Webhook Submit Action",
            },
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          data: {
            createItem: {
              item: {
                itemId: "a-new",
                name: "Notify",
                path: "/sitecore/system/Workflows/Sample/Draft/Actions/Notify",
              },
            },
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebhookApiClient({ environment: baseEnv });
    await client.createWorkflowSubmitAction({
      name: "Notify",
      url: "https://example.com/wf",
      stateOrCommandPath: "/sitecore/system/Workflows/Sample/Draft",
    });

    const body = lastFetchBody(fetchMock);
    expect(
      (body.variables as { input: { templateId: string; parent: string } }).input
    ).toMatchObject({
      templateId: "tmpl-submit",
      parent: "/sitecore/system/Workflows/Sample/Draft/Actions",
    });
  });
});

describe("webhook client — deleteWebhookItem", () => {
  it("emits a deleteItem mutation by itemId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebhookApiClient({ environment: baseEnv });
    await client.deleteWebhookItem({ itemId: "h1" });

    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain("deleteItem(input: $input)");
    expect(body.variables).toEqual({
      input: { database: "master", permanently: true, itemId: "h1" },
    });
  });

  it("throws when deleteItem returns successful=false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebhookApiClient({ environment: baseEnv });
    await expect(client.deleteWebhookItem({ itemId: "h1" })).rejects.toThrowError();
  });

  it("throws INPUT_INVALID when no selector is provided", async () => {
    const client = createWebhookApiClient({ environment: baseEnv });
    await expect(client.deleteWebhookItem({})).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});
