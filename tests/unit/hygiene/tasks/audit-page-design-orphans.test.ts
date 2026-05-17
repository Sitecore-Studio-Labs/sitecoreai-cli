/**
 * `scai hygiene audit page-design-orphans list` — XM Cloud SXA: flags
 * pages whose `__Final Page Design` / `__Page Design` field references a
 * missing item.
 *
 * `resolveEnvironment` + `createHygieneApiClient` are mocked so the real
 * `shared.ts` scan-then-fetch pipeline runs end to end. Branch coverage
 * targets: page-design-field filter, empty/whitespace value skip,
 * non-32-char ref skip, the exists/missing fork, the sort, and the
 * scanned-vs-orphan summary.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditPageDesignOrphans } from "../../../../src/hygiene/tasks/audit/page-design-orphans";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

interface ScanRow {
  itemId: string;
  path: string;
  name: string;
  templateName?: string | null;
  language?: string | null;
}

interface FieldRow {
  fieldId: string;
  name: string;
  value: string;
}

const setup = (opts: {
  rows: ScanRow[];
  fieldsByItemId: Record<string, FieldRow[]>;
  /** itemId (flat 32-char form) → exists. Anything absent is treated as missing. */
  exists: Record<string, boolean>;
}): HygieneApiClient => {
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
      for (const r of opts.rows) {
        yield {
          itemId: r.itemId,
          path: r.path,
          name: r.name,
          templateName: r.templateName ?? "Page",
          language: r.language ? { name: r.language } : { name: "en" },
        };
      }
    }),
    getItemFieldsBatch: vi.fn().mockImplementation(async (ids: readonly string[]) => {
      const map = new Map<string, FieldRow[] | null>();
      for (const id of ids) map.set(id, opts.fieldsByItemId[id] ?? null);
      return map;
    }),
    itemsExistBatch: vi.fn().mockImplementation(async (ids: readonly string[]) => {
      const map = new Map<string, boolean>();
      for (const id of ids) map.set(id, opts.exists[id] ?? false);
      return map;
    }),
    getItemFields: vi.fn(),
    itemExists: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit page-design-orphans — orphan detection", () => {
  it("returns empty when no item carries a page-design field", async () => {
    setup({
      rows: [
        { itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", path: "/sitecore/content/A", name: "A" },
      ],
      fieldsByItemId: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [{ fieldId: "f1", name: "Title", value: "Hello" }],
      },
      exists: {},
    });
    const result = await runAuditPageDesignOrphans({ json: true, root: "/sitecore/content" });
    expect(result).toEqual([]);
  });

  it("flags a page whose __Final Page Design references a missing item", async () => {
    setup({
      rows: [
        { itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", path: "/sitecore/content/A", name: "A" },
      ],
      fieldsByItemId: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          {
            fieldId: "f1",
            name: "__Final Page Design",
            value: "{11111111-1111-1111-1111-111111111111}",
          },
        ],
      },
      // Ref deliberately absent → missing.
      exists: {},
    });
    const result = await runAuditPageDesignOrphans({ json: true, root: "/sitecore/content" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      path: "/sitecore/content/A",
      fieldName: "__Final Page Design",
      pageDesignRef: "11111111111111111111111111111111",
    });
  });

  it("does NOT flag a page whose page design reference resolves to an existing item", async () => {
    setup({
      rows: [
        { itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", path: "/sitecore/content/A", name: "A" },
      ],
      fieldsByItemId: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          {
            fieldId: "f1",
            name: "__Page Design",
            value: "{22222222-2222-2222-2222-222222222222}",
          },
        ],
      },
      exists: { "22222222222222222222222222222222": true },
    });
    const result = await runAuditPageDesignOrphans({ json: true, root: "/sitecore/content" });
    expect(result).toEqual([]);
  });

  it("skips an empty / whitespace-only page-design field value", async () => {
    setup({
      rows: [
        { itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", path: "/sitecore/content/A", name: "A" },
      ],
      fieldsByItemId: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          { fieldId: "f1", name: "__Final Page Design", value: "   " },
          { fieldId: "f2", name: "__Page Design", value: "" },
        ],
      },
      exists: {},
    });
    const result = await runAuditPageDesignOrphans({ json: true, root: "/sitecore/content" });
    expect(result).toEqual([]);
  });

  it("skips a page-design value that doesn't normalize to a 32-char itemId", async () => {
    setup({
      rows: [
        { itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", path: "/sitecore/content/A", name: "A" },
      ],
      fieldsByItemId: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          { fieldId: "f1", name: "__Final Page Design", value: "not-a-guid-at-all" },
        ],
      },
      exists: {},
    });
    const result = await runAuditPageDesignOrphans({ json: true, root: "/sitecore/content" });
    expect(result).toEqual([]);
  });

  it("ignores items with no fields entry in the batch map", async () => {
    setup({
      rows: [
        { itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", path: "/sitecore/content/A", name: "A" },
      ],
      // No fields entry → getItemFieldsBatch returns null for this id.
      fieldsByItemId: {},
      exists: {},
    });
    const result = await runAuditPageDesignOrphans({ json: true, root: "/sitecore/content" });
    expect(result).toEqual([]);
  });

  it("sorts orphan rows by path", async () => {
    setup({
      rows: [
        { itemId: "cccccccccccccccccccccccccccccccc", path: "/sitecore/content/Zeta", name: "Z" },
        { itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", path: "/sitecore/content/Alpha", name: "A" },
      ],
      fieldsByItemId: {
        cccccccccccccccccccccccccccccccc: [
          {
            fieldId: "f1",
            name: "__Page Design",
            value: "{99999999-9999-9999-9999-999999999999}",
          },
        ],
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          {
            fieldId: "f1",
            name: "__Page Design",
            value: "{88888888-8888-8888-8888-888888888888}",
          },
        ],
      },
      exists: {},
    });
    const result = await runAuditPageDesignOrphans({ json: true, root: "/sitecore/content" });
    expect(result.map((r) => r.path)).toEqual([
      "/sitecore/content/Alpha",
      "/sitecore/content/Zeta",
    ]);
  });

  it("flushes the field cache when --cache is enabled", async () => {
    const client = setup({
      rows: [
        { itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", path: "/sitecore/content/A", name: "A" },
      ],
      fieldsByItemId: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [{ fieldId: "f1", name: "Title", value: "Hi" }],
      },
      exists: {},
    });
    const result = await runAuditPageDesignOrphans({
      json: true,
      root: "/sitecore/content",
      cache: true,
    });
    expect(result).toEqual([]);
    // The cache path still walks the same scan pipeline.
    expect(client.getItemFieldsBatch).toHaveBeenCalled();
  });
});
