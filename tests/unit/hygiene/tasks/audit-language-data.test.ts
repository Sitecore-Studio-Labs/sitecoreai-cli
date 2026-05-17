/**
 * `scai hygiene audit language-data list` — finds items that have a
 * per-language entry in the master DB but zero versions in that
 * language. Read-only diagnostic (no XM Cloud remediation API).
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditLanguageData } from "../../../../src/hygiene/tasks/audit/language-data";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

interface IndexRow {
  id: string;
  path: string;
  language: string;
}

/**
 * `versionsByPair` maps `${itemId}|${language}` to the number of
 * versions `getItemVersions` should report. A pair absent from the
 * map defaults to 1 version (non-empty).
 */
const setup = (rows: IndexRow[], versionsByPair: Record<string, number> = {}): HygieneApiClient => {
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
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const r of rows) {
        yield {
          itemId: r.id,
          path: r.path,
          name: r.id,
          templateName: "Page",
          language: { name: r.language },
        };
      }
    }),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi
      .fn()
      .mockImplementation(({ itemId, language }: { itemId: string; language: string }) => {
        const count = versionsByPair[`${itemId}|${language}`] ?? 1;
        return Promise.resolve(Array.from({ length: count }, (_, i) => ({ versionNumber: i + 1 })));
      }),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit language-data — report shape", () => {
  it("returns empty when every (item, language) pair has versions", async () => {
    setup([
      { id: "a", path: "/sitecore/content/a", language: "en" },
      { id: "a", path: "/sitecore/content/a", language: "fr" },
    ]);
    const reports = await runAuditLanguageData({ json: true });
    expect(reports).toEqual([]);
  });

  it("flags an item whose language entry has zero versions", async () => {
    setup(
      [
        { id: "a", path: "/sitecore/content/a", language: "en" },
        { id: "a", path: "/sitecore/content/a", language: "fr" },
      ],
      { "a|fr": 0 }
    );
    const reports = await runAuditLanguageData({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ itemId: "a", emptyLanguages: ["fr"] });
  });

  it("collects multiple empty languages under one item", async () => {
    setup(
      [
        { id: "a", path: "/sitecore/content/a", language: "en" },
        { id: "a", path: "/sitecore/content/a", language: "fr" },
        { id: "a", path: "/sitecore/content/a", language: "de" },
      ],
      { "a|fr": 0, "a|de": 0 }
    );
    const reports = await runAuditLanguageData({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].emptyLanguages.sort()).toEqual(["de", "fr"]);
  });

  it("intersects with an explicit --languages set", async () => {
    setup(
      [
        { id: "a", path: "/sitecore/content/a", language: "en" },
        { id: "a", path: "/sitecore/content/a", language: "fr" },
        { id: "a", path: "/sitecore/content/a", language: "de" },
      ],
      { "a|fr": 0, "a|de": 0 }
    );
    // Only `fr` is requested — `de` is empty too but must not be probed/reported.
    const reports = await runAuditLanguageData({ json: true, languages: ["fr"] });
    expect(reports).toHaveLength(1);
    expect(reports[0].emptyLanguages).toEqual(["fr"]);
  });

  it("excludes /sitecore/system items by default", async () => {
    setup([{ id: "sys", path: "/sitecore/system/Settings", language: "en" }], { "sys|en": 0 });
    const reports = await runAuditLanguageData({ json: true });
    expect(reports).toEqual([]);
  });

  it("includes system items when --include-system is set", async () => {
    setup([{ id: "sys", path: "/sitecore/system/Settings", language: "en" }], { "sys|en": 0 });
    const reports = await runAuditLanguageData({ json: true, includeSystem: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].itemId).toBe("sys");
  });

  it("emits a JSON envelope to stdout under --json", async () => {
    setup([{ id: "a", path: "/sitecore/content/a", language: "fr" }], { "a|fr": 0 });
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runAuditLanguageData({ json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.language-data.list");
    expect(parsed.count).toBe(1);
    expect(parsed.meta.pairsChecked).toBe(1);
  });
});

describe("audit language-data — error paths", () => {
  it("propagates an error thrown by resolveTenant", async () => {
    vi.mocked(resolveEnvironment).mockImplementation(() => {
      throw Object.assign(new Error("bad env"), { code: "CONFIG_INVALID" });
    });
    await expect(runAuditLanguageData({ json: true })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
});
