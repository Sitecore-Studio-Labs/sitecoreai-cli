/**
 * `scai hygiene audit empty-items list` — scans content for items that
 * carry author-facing fields but have no authored value in any of
 * them. These tests stub the scan pipeline (`policy/environment` +
 * the hygiene API client) so the runner's empty-detection, folder
 * skipping, sorting, and report shape are exercised without network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditEmptyItems } from "../../../../src/hygiene/tasks/audit/empty-items";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

type Item = {
  id: string;
  path?: string;
  fields: Array<{ name: string; value: string }> | null;
  templateName?: string | null;
};

const setup = (items: Item[]): HygieneApiClient => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const fieldsMap = new Map(
    items.map((it) => [
      it.id,
      it.fields === null ? null : it.fields.map((f) => ({ fieldId: "f1", ...f })),
    ])
  );
  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of items) {
        yield {
          itemId: it.id,
          path: it.path ?? `/sitecore/content/${it.id}`,
          name: it.id,
          templateName: it.templateName ?? "Page",
          language: { name: "en" },
          version: 1,
          createdDate: "2026-01-01",
          updatedDate: "2026-02-02",
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
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("audit empty-items — report shape", () => {
  it("returns an empty report when every item has authored content", async () => {
    setup([{ id: "a", fields: [{ name: "Title", value: "Has content" }] }]);
    const reports = await runAuditEmptyItems({ json: true, root: "/sitecore/content" });
    expect(reports).toEqual([]);
  });

  it("reports an item whose authored fields are all blank", async () => {
    setup([
      {
        id: "abc",
        fields: [
          { name: "Title", value: "" },
          { name: "Body", value: "   " },
        ],
      },
    ]);
    const reports = await runAuditEmptyItems({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      itemId: "abc",
      path: "/sitecore/content/abc",
      templateName: "Page",
      language: "en",
      createdDate: "2026-01-01",
      updatedDate: "2026-02-02",
    });
  });

  it("skips folder-like items that have no author-facing fields at all", async () => {
    // Only __-prefixed system fields → authored.length === 0 → skipped.
    setup([
      {
        id: "folder",
        fields: [
          { name: "__Created", value: "2026-01-01" },
          { name: "__Updated", value: "2026-02-02" },
        ],
      },
    ]);
    const reports = await runAuditEmptyItems({ json: true });
    expect(reports).toEqual([]);
  });

  it("keeps an item that has at least one non-blank authored field", async () => {
    setup([
      {
        id: "mixed",
        fields: [
          { name: "Title", value: "" },
          { name: "Summary", value: "still here" },
        ],
      },
    ]);
    const reports = await runAuditEmptyItems({ json: true });
    expect(reports).toEqual([]);
  });

  it("skips an item whose fields map entry is null (field fetch returned nothing)", async () => {
    setup([{ id: "no-fields", fields: null }]);
    const reports = await runAuditEmptyItems({ json: true });
    expect(reports).toEqual([]);
  });

  it("sorts empty-item reports by path", async () => {
    setup([
      { id: "z", path: "/sitecore/content/zeta", fields: [{ name: "Title", value: "" }] },
      { id: "a", path: "/sitecore/content/alpha", fields: [{ name: "Title", value: "" }] },
    ]);
    const reports = await runAuditEmptyItems({ json: true });
    expect(reports.map((r) => r.path)).toEqual([
      "/sitecore/content/alpha",
      "/sitecore/content/zeta",
    ]);
  });

  it("emits a JSON envelope to stdout under --json with the scanned count", async () => {
    setup([{ id: "abc", fields: [{ name: "Title", value: "" }] }]);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    await runAuditEmptyItems({ json: true });
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.empty-items.list");
    expect(parsed.count).toBe(1);
    expect(parsed.data[0].itemId).toBe("abc");
    expect(parsed.meta.scannedCount).toBe(1);
  });

  it("does NOT emit a JSON envelope to stdout when --json is off", async () => {
    setup([{ id: "abc", fields: [{ name: "Title", value: "" }] }]);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    const reports = await runAuditEmptyItems({});
    // The report is still returned for programmatic callers...
    expect(reports).toHaveLength(1);
    expect(reports[0].itemId).toBe("abc");
    // ...but no JSON envelope is written to stdout on the human path.
    expect(writes.join("")).not.toContain('"command":"audit.empty-items.list"');
  });
});

describe("audit empty-items — error paths", () => {
  it("propagates an error thrown by resolveTenant", async () => {
    vi.mocked(resolveEnvironment).mockImplementation(() => {
      throw Object.assign(new Error("no tenant"), { code: "CONFIG_NOT_FOUND" });
    });
    await expect(runAuditEmptyItems({ json: true })).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });
  });
});
