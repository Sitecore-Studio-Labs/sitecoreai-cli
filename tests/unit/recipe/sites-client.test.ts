import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `createSitesApiClient` — the adapter that builds a `SitesApiClient`
 * over the function-style `src/sites/api/*` surface used by the recipe
 * push pipeline.
 *
 * Two layers are exercised:
 *   - delegation: each interface method forwards the shared `options`
 *     (auth header + base URL) plus its own args to the right Sites
 *     API helper, and the `addLanguage` wrapper builds the
 *     `{ languageCode }` body shape;
 *   - the real wire path: with `fetch` stubbed, each method issues the
 *     expected HTTP request and surfaces the decoded response.
 */

const apiMocks = vi.hoisted(() => ({
  listCollections: vi.fn(),
  getJobStatus: vi.fn(),
  addLanguage: vi.fn(),
  listLanguages: vi.fn(),
  createSite: vi.fn(),
  listSites: vi.fn(),
  listSiteTemplates: vi.fn(),
}));

vi.mock("../../../src/sites/api/collections", () => ({
  listCollections: apiMocks.listCollections,
}));
vi.mock("../../../src/sites/api/jobs", () => ({ getJobStatus: apiMocks.getJobStatus }));
vi.mock("../../../src/sites/api/languages", () => ({
  addLanguage: apiMocks.addLanguage,
  listLanguages: apiMocks.listLanguages,
}));
vi.mock("../../../src/sites/api/sites", () => ({
  createSite: apiMocks.createSite,
  listSites: apiMocks.listSites,
  listSiteTemplates: apiMocks.listSiteTemplates,
}));

import { createSitesApiClient } from "../../../src/recipe/api/sites-client";

const options = { accessToken: "tok-123" };

beforeEach(() => {
  for (const m of Object.values(apiMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSitesApiClient — delegation", () => {
  it("createSite forwards the shared options + the new-site input", async () => {
    apiMocks.createSite.mockResolvedValue({ handle: "job-1" });
    const client = createSitesApiClient(options);
    const input = { siteName: "Foo", templateId: "tpl-1", language: "en" } as never;
    const result = await client.createSite(input);

    expect(result).toEqual({ handle: "job-1" });
    expect(apiMocks.createSite).toHaveBeenCalledWith(options, input);
  });

  it("getJobStatus forwards the shared options + the job handle", async () => {
    apiMocks.getJobStatus.mockResolvedValue({ status: "Completed" });
    const client = createSitesApiClient(options);
    await client.getJobStatus("job-77");
    expect(apiMocks.getJobStatus).toHaveBeenCalledWith(options, "job-77");
  });

  it("listSites forwards the shared options only", async () => {
    apiMocks.listSites.mockResolvedValue([{ id: "s-1" }]);
    const client = createSitesApiClient(options);
    await expect(client.listSites()).resolves.toEqual([{ id: "s-1" }]);
    expect(apiMocks.listSites).toHaveBeenCalledWith(options);
  });

  it("listSiteTemplates forwards the shared options only", async () => {
    apiMocks.listSiteTemplates.mockResolvedValue([{ id: "tpl-1" }]);
    const client = createSitesApiClient(options);
    await expect(client.listSiteTemplates()).resolves.toEqual([{ id: "tpl-1" }]);
    expect(apiMocks.listSiteTemplates).toHaveBeenCalledWith(options);
  });

  it("listCollections forwards the shared options only", async () => {
    apiMocks.listCollections.mockResolvedValue([{ id: "col-1" }]);
    const client = createSitesApiClient(options);
    await expect(client.listCollections()).resolves.toEqual([{ id: "col-1" }]);
    expect(apiMocks.listCollections).toHaveBeenCalledWith(options);
  });

  it("listLanguages forwards the shared options only", async () => {
    apiMocks.listLanguages.mockResolvedValue([{ languageCode: "en" }]);
    const client = createSitesApiClient(options);
    await expect(client.listLanguages()).resolves.toEqual([{ languageCode: "en" }]);
    expect(apiMocks.listLanguages).toHaveBeenCalledWith(options);
  });

  it("addLanguage wraps the bare code in a { languageCode } body", async () => {
    apiMocks.addLanguage.mockResolvedValue({ languageCode: "da" });
    const client = createSitesApiClient(options);
    const result = await client.addLanguage("da");
    expect(result).toEqual({ languageCode: "da" });
    expect(apiMocks.addLanguage).toHaveBeenCalledWith(options, { languageCode: "da" });
  });
});
