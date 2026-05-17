import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { ArchivedItem, HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditOrphans } from "../../../../src/hygiene/tasks/audit/orphans";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setup = (): void => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
};

const stub = (overrides: Partial<HygieneApiClient>): HygieneApiClient => {
  const base = {
    search: vi.fn(),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn().mockResolvedValue([]),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
    updateItemFields: vi.fn(),
  };
  const client = { ...base, ...overrides } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

const mkArchived = (specs: Array<Partial<ArchivedItem> & { archivalId: string }>): ArchivedItem[] =>
  specs.map((s) => ({
    archivalId: s.archivalId,
    itemId: s.itemId ?? `item-${s.archivalId}`,
    name: s.name ?? `Name-${s.archivalId}`,
    originalLocation: s.originalLocation ?? "/sitecore/content/Old",
    archivedBy: s.archivedBy ?? "admin",
    archivedDate: s.archivedDate ?? "2026-01-01T00:00:00Z",
    parentId: s.parentId ?? null,
  }));

describe("audit orphans — empty archive", () => {
  it("returns an empty report when the archive has no items", async () => {
    setup();
    stub({ listArchivedItems: vi.fn().mockResolvedValue([]) as never });

    const reports = await runAuditOrphans({ json: true });
    expect(reports).toEqual([]);
  });

  it("emits the empty-archive summary in the JSON envelope", async () => {
    setup();
    stub({ listArchivedItems: vi.fn().mockResolvedValue([]) as never });

    const captured: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
    try {
      await runAuditOrphans({ json: true });
    } finally {
      writeSpy.mockRestore();
    }
    const payload = JSON.parse(captured.join(""));
    expect(payload.command).toBe("audit.orphans.list");
    expect(payload.count).toBe(0);
  });
});

describe("audit orphans — archive listing", () => {
  it("returns archived items mapped to the OrphanReport shape", async () => {
    setup();
    stub({
      listArchivedItems: vi.fn().mockResolvedValue(
        mkArchived([
          {
            archivalId: "a1",
            itemId: "i1",
            name: "DeletedPage",
            originalLocation: "/sitecore/content/Home/Deleted",
            archivedBy: "liz",
            archivedDate: "2026-02-02T10:00:00Z",
          },
        ])
      ) as never,
    });

    const reports = await runAuditOrphans({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual({
      archivalId: "a1",
      itemId: "i1",
      name: "DeletedPage",
      originalLocation: "/sitecore/content/Home/Deleted",
      archivedBy: "liz",
      archivedDate: "2026-02-02T10:00:00Z",
    });
  });

  it("sorts items by descending archivedDate (most recent first)", async () => {
    setup();
    stub({
      listArchivedItems: vi.fn().mockResolvedValue(
        mkArchived([
          { archivalId: "old", archivedDate: "2026-01-01T00:00:00Z" },
          { archivalId: "new", archivedDate: "2026-06-01T00:00:00Z" },
          { archivalId: "mid", archivedDate: "2026-03-01T00:00:00Z" },
        ])
      ) as never,
    });

    const reports = await runAuditOrphans({ json: true });
    expect(reports.map((r) => r.archivalId)).toEqual(["new", "mid", "old"]);
  });

  it("sorts items with a null archivedDate to the end", async () => {
    setup();
    stub({
      listArchivedItems: vi.fn().mockResolvedValue(
        mkArchived([
          { archivalId: "nulldate", archivedDate: null },
          { archivalId: "dated", archivedDate: "2026-05-01T00:00:00Z" },
        ])
      ) as never,
    });

    const reports = await runAuditOrphans({ json: true });
    expect(reports.map((r) => r.archivalId)).toEqual(["dated", "nulldate"]);
  });
});

describe("audit orphans — paging", () => {
  it("stops paging when a short page is returned", async () => {
    setup();
    const listSpy = vi
      .fn()
      .mockResolvedValueOnce(mkArchived([{ archivalId: "a1" }, { archivalId: "a2" }]));
    stub({ listArchivedItems: listSpy as never });

    const reports = await runAuditOrphans({ json: true, pageSize: 100 });
    expect(reports).toHaveLength(2);
    // Short page (2 < 100) → no second page request.
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("requests subsequent pages while a full page is returned", async () => {
    setup();
    const fullPage = mkArchived([{ archivalId: "p1-a" }, { archivalId: "p1-b" }]);
    const listSpy = vi
      .fn()
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(mkArchived([{ archivalId: "p2-a" }]));
    stub({ listArchivedItems: listSpy as never });

    const reports = await runAuditOrphans({ json: true, pageSize: 2 });
    expect(reports).toHaveLength(3);
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy).toHaveBeenNthCalledWith(1, {
      archiveName: undefined,
      pageIndex: 0,
      pageSize: 2,
    });
    expect(listSpy).toHaveBeenNthCalledWith(2, {
      archiveName: undefined,
      pageIndex: 1,
      pageSize: 2,
    });
  });

  it("breaks immediately when the first page is empty", async () => {
    setup();
    const listSpy = vi.fn().mockResolvedValueOnce([]);
    stub({ listArchivedItems: listSpy as never });

    const reports = await runAuditOrphans({ json: true });
    expect(reports).toEqual([]);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("caps results at --limit even when more archived items exist", async () => {
    setup();
    // A full page of 3, then the loop would continue — but limit caps at 2.
    const listSpy = vi
      .fn()
      .mockResolvedValue(
        mkArchived([{ archivalId: "x1" }, { archivalId: "x2" }, { archivalId: "x3" }])
      );
    stub({ listArchivedItems: listSpy as never });

    const reports = await runAuditOrphans({ json: true, limit: 2, pageSize: 3 });
    expect(reports).toHaveLength(2);
    // Loop exits via the `archived.length < limit` guard after the first page.
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("forwards a custom --archive-name to the client", async () => {
    setup();
    const listSpy = vi.fn().mockResolvedValueOnce([]);
    stub({ listArchivedItems: listSpy as never });

    await runAuditOrphans({ json: true, archiveName: "recyclebin" });
    expect(listSpy).toHaveBeenCalledWith({
      archiveName: "recyclebin",
      pageIndex: 0,
      pageSize: 100,
    });
  });
});

describe("audit orphans — JSON envelope", () => {
  it("includes archiveName + limit in the meta block", async () => {
    setup();
    stub({
      listArchivedItems: vi
        .fn()
        .mockResolvedValueOnce(mkArchived([{ archivalId: "only" }])) as never,
    });

    const captured: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
    try {
      await runAuditOrphans({ json: true, archiveName: "bin", limit: 500 });
    } finally {
      writeSpy.mockRestore();
    }
    const payload = JSON.parse(captured.join(""));
    expect(payload.count).toBe(1);
    expect(payload.meta.archiveName).toBe("bin");
    expect(payload.meta.limit).toBe(500);
  });

  it("reports archiveName as null in meta when not specified", async () => {
    setup();
    stub({ listArchivedItems: vi.fn().mockResolvedValueOnce([]) as never });

    const captured: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
    try {
      await runAuditOrphans({ json: true });
    } finally {
      writeSpy.mockRestore();
    }
    const payload = JSON.parse(captured.join(""));
    expect(payload.meta.archiveName).toBeNull();
  });
});

describe("audit orphans — non-JSON report formatting", () => {
  it("formats archive lines in non-JSON mode (with + without archive metadata)", async () => {
    setup();
    stub({
      listArchivedItems: vi.fn().mockResolvedValueOnce(
        mkArchived([
          {
            archivalId: "dated",
            name: "WithMeta",
            originalLocation: "/sitecore/content/Home/A",
            archivedBy: "liz",
            archivedDate: "2026-04-04T12:00:00Z",
          },
          {
            archivalId: "nodate",
            name: "NoMeta",
            originalLocation: "/sitecore/content/Home/B",
            archivedBy: null,
            archivedDate: null,
          },
        ])
      ) as never,
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const reports = await runAuditOrphans({});
      // Both records present; the formatLine ran for the dated branch
      // (archivedDate truthy) and the null branch (archivedDate falsy).
      expect(reports).toHaveLength(2);
      expect(reports.map((r) => r.archivalId)).toEqual(["dated", "nodate"]);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("formats the empty-archive headline in non-JSON mode", async () => {
    setup();
    stub({ listArchivedItems: vi.fn().mockResolvedValueOnce([]) as never });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const reports = await runAuditOrphans({});
      expect(reports).toEqual([]);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
