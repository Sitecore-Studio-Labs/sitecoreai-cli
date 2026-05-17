/**
 * `scai hygiene audit datasource-missing list` — parses rendering XML
 * (`__Renderings`) for `ds=` datasources and reports the ones that
 * don't resolve to an existing item or path.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditDatasourceMissing } from "../../../../src/hygiene/tasks/audit/datasource-missing";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

interface SetupArgs {
  items: Array<{ id: string; fields: Array<{ name: string; value: string }> }>;
  /** itemId(normalized) → exists. */
  idExists?: Record<string, boolean>;
  /** _fullpath(lowercase) → totalCount returned by search. */
  pathTotals?: Record<string, number>;
}

const setup = ({ items, idExists = {}, pathTotals = {} }: SetupArgs): HygieneApiClient => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const fieldsMap = new Map(
    items.map((it) => [it.id, it.fields.map((f) => ({ fieldId: "f1", ...f }))])
  );
  const client = {
    // search is used both for root resolution and for path-datasource probes.
    search: vi
      .fn()
      .mockImplementation((q: { searchStatement?: { criteria?: { value?: string } } }) => {
        const value = q.searchStatement?.criteria?.value ?? "";
        if (value === "/sitecore/content") {
          return Promise.resolve({
            totalCount: 1,
            results: [{ itemId: "rootid", path: "/sitecore/content" }],
          });
        }
        const total = pathTotals[value] ?? 0;
        return Promise.resolve({ totalCount: total, results: [] });
      }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of items) {
        yield {
          itemId: it.id,
          path: `/sitecore/content/${it.id}`,
          name: it.id,
          templateName: "Page",
          language: { name: "en" },
          version: 1,
        };
      }
    }),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn().mockImplementation((ids: string[]) => {
      const m = new Map();
      for (const id of ids) m.set(id, fieldsMap.get(id) ?? null);
      return Promise.resolve(m);
    }),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn().mockImplementation((ids: string[]) => {
      const m = new Map();
      for (const id of ids) m.set(id, idExists[id] ?? true);
      return Promise.resolve(m);
    }),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

const GUID = "{abc12345-0000-0000-0000-000000000099}";
const GUID_FLAT = "abc12345000000000000000000000099";

describe("audit datasource-missing — report shape", () => {
  it("returns an empty report when every datasource resolves", async () => {
    setup({
      items: [{ id: "a", fields: [{ name: "__Renderings", value: `<r id="r1" ds="${GUID}" />` }] }],
      idExists: { [GUID_FLAT]: true },
    });
    const reports = await runAuditDatasourceMissing({ json: true });
    expect(reports).toEqual([]);
  });

  it("flags an item whose GUID datasource does not exist", async () => {
    setup({
      items: [{ id: "a", fields: [{ name: "__Renderings", value: `<r id="r1" ds="${GUID}" />` }] }],
      idExists: { [GUID_FLAT]: false },
    });
    const reports = await runAuditDatasourceMissing({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      itemId: "a",
      missingDatasources: [{ fieldName: "__Renderings", renderingId: "r1", datasource: GUID }],
    });
  });

  it("flags a path datasource that resolves to zero search hits", async () => {
    setup({
      items: [
        {
          id: "a",
          fields: [
            { name: "__Renderings", value: '<r id="r1" ds="/sitecore/content/Missing/DS" />' },
          ],
        },
      ],
      pathTotals: { "/sitecore/content/missing/ds": 0 },
    });
    const reports = await runAuditDatasourceMissing({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].missingDatasources[0].datasource).toBe("/sitecore/content/Missing/DS");
  });

  it("does not flag a path datasource that resolves to >= 1 search hit", async () => {
    setup({
      items: [
        {
          id: "a",
          fields: [{ name: "__Renderings", value: '<r id="r1" ds="/sitecore/content/Real/DS" />' }],
        },
      ],
      pathTotals: { "/sitecore/content/real/ds": 1 },
    });
    const reports = await runAuditDatasourceMissing({ json: true });
    expect(reports).toEqual([]);
  });

  it("ignores query: datasources by default", async () => {
    setup({
      items: [
        {
          id: "a",
          fields: [
            {
              name: "__Renderings",
              value:
                '<r id="r1" ds="query:./ancestor-or-self::*[@@templatename=&quot;Site&quot;]" />',
            },
          ],
        },
      ],
    });
    const reports = await runAuditDatasourceMissing({ json: true });
    expect(reports).toEqual([]);
  });

  it("flags query: datasources when --report-query-datasources is set", async () => {
    setup({
      items: [
        {
          id: "a",
          fields: [{ name: "__Renderings", value: '<r id="r1" ds="query:./Data" />' }],
        },
      ],
    });
    const reports = await runAuditDatasourceMissing({
      json: true,
      reportQueryDatasources: true,
    });
    expect(reports).toHaveLength(1);
    expect(reports[0].missingDatasources[0].datasource).toBe("query:./Data");
  });

  it("ignores non-rendering fields", async () => {
    setup({
      items: [{ id: "a", fields: [{ name: "Body", value: `<r id="r1" ds="${GUID}" />` }] }],
      idExists: { [GUID_FLAT]: false },
    });
    const reports = await runAuditDatasourceMissing({ json: true });
    expect(reports).toEqual([]);
  });

  it("groups multiple missing datasources under one item", async () => {
    setup({
      items: [
        {
          id: "a",
          fields: [
            {
              name: "__Renderings",
              value: `<r id="r1" ds="${GUID}" /><r id="r2" ds="/sitecore/content/Gone" />`,
            },
          ],
        },
      ],
      idExists: { [GUID_FLAT]: false },
      pathTotals: { "/sitecore/content/gone": 0 },
    });
    const reports = await runAuditDatasourceMissing({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].missingDatasources).toHaveLength(2);
  });

  it("emits a JSON envelope to stdout under --json", async () => {
    setup({
      items: [{ id: "a", fields: [{ name: "__Renderings", value: `<r id="r1" ds="${GUID}" />` }] }],
      idExists: { [GUID_FLAT]: false },
    });
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runAuditDatasourceMissing({ json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.datasource-missing.list");
    expect(parsed.count).toBe(1);
    expect(parsed.meta.scannedCount).toBe(1);
  });
});

describe("audit datasource-missing — error paths", () => {
  it("propagates an error thrown by resolveTenant", async () => {
    vi.mocked(resolveEnvironment).mockImplementation(() => {
      throw Object.assign(new Error("no env"), { code: "CONFIG_NOT_FOUND" });
    });
    await expect(runAuditDatasourceMissing({ json: true })).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });
  });
});
