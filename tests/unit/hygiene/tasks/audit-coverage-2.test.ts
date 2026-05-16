import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditFallbackDrift } from "../../../../src/hygiene/tasks/audit/fallback-drift";
import { runAuditSlugConflicts } from "../../../../src/hygiene/tasks/audit/slug-conflicts";
import { runAuditTranslationCoverage } from "../../../../src/hygiene/tasks/audit/translation-coverage";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
const setupEnv = () => {
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
};

const stubClient = (overrides: Partial<HygieneApiClient>): HygieneApiClient => {
  const base = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content" }],
    }),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
    updateItemFields: vi.fn(),
    listUsers: vi.fn(),
    listRoles: vi.fn(),
    getUserDetail: vi.fn(),
  };
  const client = { ...base, ...overrides } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit slug-conflicts", () => {
  it("groups by (parent, lowercase slug) and flags >= 2", async () => {
    setupEnv();
    stubClient({
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "a",
          path: "/sitecore/content/Site/About",
          name: "About",
          language: { name: "en" },
          version: 1,
        };
        yield {
          itemId: "b",
          path: "/sitecore/content/Site/about",
          name: "about",
          language: { name: "en" },
          version: 1,
        };
        yield {
          itemId: "c",
          path: "/sitecore/content/Site/Other",
          name: "Other",
          language: { name: "en" },
          version: 1,
        };
      }),
    });
    const result = await runAuditSlugConflicts({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
    expect(result[0].slug).toBe("about");
  });

  it("does not collapse cross-language entries with the same itemId", async () => {
    setupEnv();
    stubClient({
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "a",
          path: "/sitecore/content/Site/About",
          name: "About",
          language: { name: "en" },
          version: 1,
        };
        yield {
          itemId: "a",
          path: "/sitecore/content/Site/About",
          name: "About",
          language: { name: "fr" },
          version: 1,
        };
      }),
    });
    const result = await runAuditSlugConflicts({ json: true } as never);
    expect(result).toHaveLength(0);
  });
});

describe("audit translation-coverage", () => {
  it("computes coverage % between reference + target languages", async () => {
    setupEnv();
    let lang = "";
    stubClient({
      searchAll: vi.fn().mockImplementation((q: { language?: string }) => {
        lang = q.language ?? "";
        return (async function* () {
          if (lang === "en") {
            for (const id of ["a", "b", "c", "d"]) {
              yield {
                itemId: id,
                path: `/sitecore/content/x/${id}`,
                name: id,
                language: { name: "en" },
                version: 1,
              };
            }
          } else if (lang === "fr") {
            for (const id of ["a", "b"]) {
              yield {
                itemId: id,
                path: `/sitecore/content/x/${id}`,
                name: id,
                language: { name: "fr" },
                version: 1,
              };
            }
          }
        })();
      }) as never,
    });
    const result = await runAuditTranslationCoverage({
      referenceLanguage: "en",
      targetLanguages: ["fr"],
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].language).toBe("fr");
    expect(result[0].totalReferenceItems).toBe(4);
    expect(result[0].translatedItems).toBe(2);
    expect(result[0].missingItems).toBe(2);
    expect(result[0].coveragePercent).toBe(50);
  });

  // Regression: previously `missingItems` was derived from the
  // 100-cap sample list, so any language with > 100 missing items
  // reported exactly 100 missing regardless of the real number.
  it("counts every missing item even when over the 100-sample cap", async () => {
    setupEnv();
    const referenceIds = Array.from(
      { length: 250 },
      (_, i) => `id${i.toString().padStart(4, "0")}`
    );
    stubClient({
      searchAll: vi.fn().mockImplementation((q: { language?: string }) => {
        const lang = q.language ?? "";
        return (async function* () {
          if (lang === "en") {
            for (const id of referenceIds) {
              yield {
                itemId: id,
                path: `/sitecore/content/x/${id}`,
                name: id,
                language: { name: "en" },
                version: 1,
              };
            }
          }
          // ja-JP has zero items — every reference id is missing.
        })();
      }) as never,
    });
    const result = await runAuditTranslationCoverage({
      referenceLanguage: "en",
      targetLanguages: ["ja-JP"],
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].totalReferenceItems).toBe(250);
    expect(result[0].translatedItems).toBe(0);
    expect(result[0].missingItems).toBe(250);
    expect(result[0].coveragePercent).toBe(0);
    // Sample list stays capped at 100.
    expect(result[0].missingSamples).toHaveLength(100);
  });
});

describe("audit fallback-drift", () => {
  it("flags items where target updatedDate lags reference by > driftDays", async () => {
    setupEnv();
    const now = Date.now();
    const refDate = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    const stalefr = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    const freshFr = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    stubClient({
      searchAll: vi.fn().mockImplementation((q: { language?: string }) => {
        const lang = q.language ?? "";
        return (async function* () {
          if (lang === "en") {
            yield {
              itemId: "a",
              path: "/x/a",
              name: "a",
              language: { name: "en" },
              updatedDate: refDate,
            };
            yield {
              itemId: "b",
              path: "/x/b",
              name: "b",
              language: { name: "en" },
              updatedDate: refDate,
            };
          } else if (lang === "fr") {
            yield {
              itemId: "a",
              path: "/x/a",
              name: "a",
              language: { name: "fr" },
              updatedDate: stalefr,
            };
            yield {
              itemId: "b",
              path: "/x/b",
              name: "b",
              language: { name: "fr" },
              updatedDate: freshFr,
            };
          }
        })();
      }) as never,
    });
    const result = await runAuditFallbackDrift({
      referenceLanguage: "en",
      targetLanguages: ["fr"],
      driftDays: 30,
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe("a");
    expect(result[0].driftDays).toBeGreaterThanOrEqual(85);
  });
});
