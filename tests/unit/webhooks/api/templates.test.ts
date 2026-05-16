import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../../src/config/types";
import { createWebhookTemplateResolver } from "../../../../src/webhooks/api/templates";

vi.mock("../../../../src/serialization/api/auth", () => ({
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webhook template resolver", () => {
  it("caches each path so the same item is fetched once", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "t1",
            name: "Webhook Event Handler",
            path: "/sitecore/templates/System/Webhooks/Webhook Event Handler",
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = createWebhookTemplateResolver(baseEnv);
    const a = await r.webhookEventHandlerTemplateId();
    const b = await r.webhookEventHandlerTemplateId();
    expect(a).toBe("t1");
    expect(b).toBe("t1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws ENV_NOT_FOUND when the template path resolves to nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const r = createWebhookTemplateResolver(baseEnv);
    await expect(r.webhookSubmitActionTemplateId()).rejects.toMatchObject({
      code: "ENV_NOT_FOUND",
    });
  });

  it("resolves event-type names to item IDs in the right catalog subfolder", async () => {
    const fetchMock = vi
      .fn()
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
      .mockResolvedValueOnce(
        okResponse({
          data: {
            item: {
              itemId: "e-publish-end",
              name: "publish:end",
              path: "/sitecore/system/Settings/Webhooks/Event Types/Publish/publish:end",
            },
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const r = createWebhookTemplateResolver(baseEnv);
    const ids = await r.resolveEventTypeIds(["item:saved", "publish:end"]);

    expect(ids).toEqual(["e-item-saved", "e-publish-end"]);
    const itemBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);
    expect(itemBody.variables).toEqual({
      path: "/sitecore/system/Settings/Webhooks/Event Types/Item/item:saved",
    });
    const pubBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as { body: string }).body);
    expect(pubBody.variables).toEqual({
      path: "/sitecore/system/Settings/Webhooks/Event Types/Publish/publish:end",
    });
  });

  it("throws INPUT_INVALID when an event name doesn't resolve", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const r = createWebhookTemplateResolver(baseEnv);
    await expect(r.resolveEventTypeIds(["item:made-up"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});
