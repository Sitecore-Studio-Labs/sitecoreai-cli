import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSitesApiClient } from "../../../src/recipe/api/sites-client";
import { DEFAULT_SITES_API_BASE } from "../../../src/sites/api/types";

/**
 * `createSitesApiClient` over the real `src/sites/api/*` helpers with
 * `fetch` stubbed. Asserts each adapter method issues the right HTTP
 * verb + path against the resolved base URL and decodes the response.
 * Distinct from `sites-client.test.ts`, which mocks the helper layer.
 */

const options = { accessToken: "tok-abc" };

const okResponse = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSitesApiClient — wire path", () => {
  it("listSites issues GET /api/v1/sites and decodes the array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: "s-1", name: "Site" }]));
    vi.stubGlobal("fetch", fetchMock);

    const sites = await createSitesApiClient(options).listSites();

    expect(sites).toEqual([{ id: "s-1", name: "Site" }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites`);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("listSiteTemplates issues GET /api/v1/sites/templates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: "tpl-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await createSitesApiClient(options).listSiteTemplates();
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites/templates`);
  });

  it("listCollections issues GET /api/v1/collections", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: "col-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await createSitesApiClient(options).listCollections();
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/collections`);
  });

  it("listLanguages issues GET /api/v1/languages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ languageCode: "en" }]));
    vi.stubGlobal("fetch", fetchMock);

    await createSitesApiClient(options).listLanguages();
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/languages`);
  });

  it("getJobStatus issues GET /api/v1/jobs/{handle}/status with the handle URL-encoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ status: "Completed" }));
    vi.stubGlobal("fetch", fetchMock);

    const job = await createSitesApiClient(options).getJobStatus("job 1/2");
    expect(job).toEqual({ status: "Completed" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${DEFAULT_SITES_API_BASE}/api/v1/jobs/job%201%2F2/status`
    );
  });

  it("createSite issues POST /api/v1/sites with the JSON body and bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ handle: "job-99" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createSitesApiClient(options).createSite({
      siteName: "Foo",
      templateId: "tpl-1",
      language: "en",
    } as never);

    expect(result).toEqual({ handle: "job-99" });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok-abc");
    expect(JSON.parse(init.body)).toEqual({
      siteName: "Foo",
      templateId: "tpl-1",
      language: "en",
    });
  });

  it("retrieveSite issues GET /api/v1/sites/{siteId}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "s-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createSitesApiClient(options).retrieveSite("s-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites/s-1`);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("updateSite issues PATCH /api/v1/sites/{siteId} with only the patched fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "s-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createSitesApiClient(options).updateSite("s-1", {
      supportedLanguages: ["en", "de-DE"],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites/s-1`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ supportedLanguages: ["en", "de-DE"] });
  });

  it("addLanguage issues POST /api/v1/languages with a { languageCode } body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ languageCode: "da" }));
    vi.stubGlobal("fetch", fetchMock);

    await createSitesApiClient(options).addLanguage("da");
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/languages`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ languageCode: "da" });
  });

  it("surfaces SITES_API_FAILED when the underlying request returns a non-2xx status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await createSitesApiClient(options)
      .listSites()
      .catch((e) => e);
    expect(error.code).toBe("SITES_API_FAILED");
  });
});
