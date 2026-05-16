/**
 * Coverage for the capped-count regression in `audit translation-coverage`.
 *
 * Pre-fix the audit reused the sample array (capped at 100) as the
 * missing-count source: when a tenant had >100 untranslated items, the
 * report showed `missingItems: 100` and `translatedItems = total - 100`
 * regardless of the real gap. Coverage % was off by an order of
 * magnitude. The fix tracks `missingCount` separately from
 * `missingSamples`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditTranslationCoverage } from "../../../../src/hygiene/tasks/audit/translation-coverage";

const setup = (params: {
  /** itemIds present in the reference language (en). */
  referenceIds: string[];
  /** itemIds present in the target language. */
  targetIds: string[];
}) => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* (query: { language?: string }) {
      const ids = query.language === "fr" ? params.targetIds : params.referenceIds;
      for (const id of ids) {
        yield {
          itemId: id,
          path: `/sitecore/content/${id.slice(0, 6)}`,
          name: id,
          templateName: "Page",
          language: { name: query.language },
          version: 1,
        };
      }
    }),
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
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("audit translation-coverage — capped-count fix", () => {
  it("reports the FULL missing count when there are more than 100 untranslated items", async () => {
    // 500 source items, 0 in target → 500 missing, not 100.
    const referenceIds = Array.from(
      { length: 500 },
      (_, i) => `${i.toString(16).padStart(32, "0")}`
    );
    setup({ referenceIds, targetIds: [] });
    const result = await runAuditTranslationCoverage({
      json: true,
      targetLanguages: ["fr"],
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      language: "fr",
      totalReferenceItems: 500,
      translatedItems: 0,
      missingItems: 500,
      coveragePercent: 0,
    });
    // Samples list is still capped — the sampling rule is intentional.
    expect(result[0].missingSamples).toHaveLength(100);
  });

  it("computes coverage correctly for a partial-translation tenant", async () => {
    const referenceIds = Array.from(
      { length: 200 },
      (_, i) => `${i.toString(16).padStart(32, "0")}`
    );
    // First 50 are translated.
    const targetIds = referenceIds.slice(0, 50);
    setup({ referenceIds, targetIds });
    const result = await runAuditTranslationCoverage({
      json: true,
      targetLanguages: ["fr"],
    } as never);
    expect(result[0]).toMatchObject({
      language: "fr",
      totalReferenceItems: 200,
      translatedItems: 50,
      missingItems: 150,
      coveragePercent: 25,
    });
  });
});
