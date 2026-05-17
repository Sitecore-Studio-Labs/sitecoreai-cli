import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSite,
  deleteSite,
  listSites,
  listSiteTemplates,
  retrieveSite,
  setSiteBrandKit,
  updateSite,
} from "../../../../src/sites/api/sites";
import { DEFAULT_SITES_API_BASE } from "../../../../src/sites/api/types";

const baseOptions = { accessToken: "test-token" };

const okResponse = (body: unknown, status = 200) =>
  new Response(status === 204 ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sites API — recipe-required helpers", () => {
  it("createSite POSTs the input body to /api/v1/sites and returns the JobResponse", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ jobHandle: "job-create-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createSite(baseOptions, {
      siteName: "skate-park",
      templateId: "tpl-1",
      language: "en",
      collectionName: "Brand A",
    });

    expect(result).toEqual({ jobHandle: "job-create-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      siteName: "skate-park",
      templateId: "tpl-1",
      language: "en",
      collectionName: "Brand A",
    });
  });

  it("retrieveSite GETs /api/v1/sites/{siteId} with URL-encoded path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "abc/def" }));
    vi.stubGlobal("fetch", fetchMock);

    await retrieveSite(baseOptions, "abc/def");

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites/abc%2Fdef`);
  });

  it("listSites GETs /api/v1/sites and returns the array body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: "1", name: "Solterra" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listSites(baseOptions);

    expect(result).toEqual([{ id: "1", name: "Solterra" }]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites`);
  });

  it("deleteSite DELETEs /api/v1/sites/{siteId} and returns a JobResponse", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ jobHandle: "job-delete-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteSite(baseOptions, "abc-123");

    expect(result).toEqual({ jobHandle: "job-delete-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites/abc-123`);
    expect(init.method).toBe("DELETE");
  });

  it("listSiteTemplates GETs /api/v1/sites/templates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: "tpl-1", name: "Skate Park" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listSiteTemplates(baseOptions);

    expect(result).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites/templates`);
  });

  it("updateSite PATCHes /api/v1/sites/{siteId} with the partial body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ id: "site-1", displayName: "Renamed" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateSite(baseOptions, "site-1", { displayName: "Renamed" });

    expect(result).toEqual({ id: "site-1", displayName: "Renamed" });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites/site-1`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ displayName: "Renamed" });
  });

  it("updateSite threads environmentId into the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "site-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await updateSite(baseOptions, "site-1", { description: "x" }, { environmentId: "main" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${DEFAULT_SITES_API_BASE}/api/v1/sites/site-1?environmentId=main`
    );
  });

  it("setSiteBrandKit PATCHes only brandKitId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "site-1", brandKitId: "kit-9" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setSiteBrandKit(baseOptions, "site-1", "kit-9");

    expect(result).toEqual({ id: "site-1", brandKitId: "kit-9" });
    const [, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ brandKitId: "kit-9" });
  });

  it("setSiteBrandKit sends brandKitId: null to detach a kit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "site-1", brandKitId: null }));
    vi.stubGlobal("fetch", fetchMock);

    await setSiteBrandKit(baseOptions, "site-1", null);

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ brandKitId: null });
  });
});
