import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCollection,
  listCollections,
  retrieveCollection,
} from "../../../../src/sites/api/collections";
import {
  addLanguage,
  listLanguages,
  listSupportedLanguages,
  updateLanguage,
  removeLanguage,
  parseLanguageCode,
} from "../../../../src/sites/api/languages";
import { getJobStatus, listJobs } from "../../../../src/sites/api/jobs";
import { DEFAULT_SITES_API_BASE } from "../../../../src/sites/api/types";

const baseOptions = { accessToken: "test-token" };

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collections API helpers", () => {
  it("listCollections GETs /api/v1/collections", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: "c1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await listCollections(baseOptions);

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/collections`);
  });

  it("createCollection POSTs the input and returns a JobResponse", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ jobHandle: "j1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCollection(baseOptions, {
      name: "Brand A",
      displayName: "Brand A Sites",
    });

    expect(result).toEqual({ jobHandle: "j1" });
    const [, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Brand A",
      displayName: "Brand A Sites",
    });
  });

  it("retrieveCollection GETs /api/v1/collections/{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "c1" }));
    vi.stubGlobal("fetch", fetchMock);

    await retrieveCollection(baseOptions, "c1");

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/collections/c1`);
  });
});

describe("languages API helpers", () => {
  it("listLanguages GETs /api/v1/languages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ isoCode: "en" }]));
    vi.stubGlobal("fetch", fetchMock);

    await listLanguages(baseOptions);

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/languages`);
  });

  it("addLanguage POSTs the input to /api/v1/languages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ isoCode: "da" }));
    vi.stubGlobal("fetch", fetchMock);

    await addLanguage(baseOptions, { languageCode: "da" });

    const [, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ languageCode: "da" });
  });

  it("listSupportedLanguages GETs /api/v1/languages/supported", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ iso: "en" }]));
    vi.stubGlobal("fetch", fetchMock);

    await listSupportedLanguages(baseOptions);

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/languages/supported`);
  });

  it("updateLanguage PATCHes the body to /api/v1/languages/{isoCode}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateLanguage(baseOptions, "fr-FR", { name: "Français" } as never);

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/languages/fr-FR`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Français" });
  });

  it("removeLanguage DELETEs /api/v1/languages/{isoCode} and URL-encodes it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    await removeLanguage(baseOptions, "fr-CA/x");

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/languages/fr-CA%2Fx`);
    expect(init.method).toBe("DELETE");
  });

  it("parseLanguageCode splits a regional code into languageCode + regionCode", () => {
    // The Sites API rejects a combined `fr-FR` languageCode — it must be split.
    expect(parseLanguageCode("fr-FR")).toEqual({ languageCode: "fr", regionCode: "FR" });
    expect(parseLanguageCode("ar-SA")).toEqual({ languageCode: "ar", regionCode: "SA" });
    // A bare language carries no region.
    expect(parseLanguageCode("en")).toEqual({ languageCode: "en" });
    // Multi-part subtags keep everything after the first dash as the region.
    expect(parseLanguageCode("zh-Hant-TW")).toEqual({ languageCode: "zh", regionCode: "Hant-TW" });
  });
});

describe("jobs API helpers", () => {
  it("getJobStatus GETs /api/v1/jobs/{handle}/status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ handle: "j1", status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getJobStatus(baseOptions, "j1");

    expect(result).toMatchObject({ handle: "j1", status: "completed" });
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/jobs/j1/status`);
  });

  it("listJobs GETs /api/v1/jobs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await listJobs(baseOptions);

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/jobs`);
  });
});
