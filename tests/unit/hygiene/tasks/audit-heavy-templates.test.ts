import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditHeavyTemplates } from "../../../../src/hygiene/tasks/audit/heavy-templates";

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
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn().mockResolvedValue([]),
    getChildren: vi.fn().mockResolvedValue([]),
    updateItemFields: vi.fn(),
  };
  const client = { ...base, ...overrides } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

/**
 * Build a `getChildren` mock that maps section itemIds → a field-count.
 * The first call (template root) returns the section list; subsequent
 * calls (per section) return field children matching the requested count.
 */
const childrenByCount = (sectionMap: Record<string, number>): HygieneApiClient["getChildren"] =>
  vi.fn().mockImplementation(({ itemId }: { itemId: string }) => {
    if (itemId in sectionMap) {
      // section → N fields
      return Promise.resolve(
        Array.from({ length: sectionMap[itemId]! }, (_, i) => ({
          itemId: `${itemId}-f${i}`,
          name: `Field${i}`,
          path: `/p/${itemId}/Field${i}`,
          templateId: null,
          templateName: "Template field",
        }))
      );
    }
    // template root → one section per key in sectionMap
    return Promise.resolve(
      Object.keys(sectionMap).map((sid) => ({
        itemId: sid,
        name: sid,
        path: `/p/${sid}`,
        templateId: null,
        templateName: "Template section",
      }))
    );
  }) as never;

describe("audit heavy-templates — threshold branches", () => {
  it("returns empty report when every template is below the threshold", async () => {
    setup();
    stub({
      listItemTemplates: vi
        .fn()
        .mockResolvedValue([
          { templateId: "tmpl-light", name: "Light", fullName: "Project/Light" },
        ]) as never,
      getChildren: childrenByCount({ "tmpl-light-sec": 3 }),
    });

    const reports = await runAuditHeavyTemplates({ json: true });
    expect(reports).toEqual([]);
  });

  it("flags a template at or above the threshold", async () => {
    setup();
    stub({
      listItemTemplates: vi
        .fn()
        .mockResolvedValue([
          { templateId: "tmpl-heavy", name: "Heavy", fullName: "Project/Heavy" },
        ]) as never,
      // Two sections, 30 + 30 = 60 fields >= default threshold 50.
      getChildren: childrenByCount({ "tmpl-heavy-sec-a": 30, "tmpl-heavy-sec-b": 30 }),
    });

    const reports = await runAuditHeavyTemplates({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      templateId: "tmpl-heavy",
      name: "Heavy",
      fullName: "Project/Heavy",
      fieldCount: 60,
    });
  });

  it("honors a custom --threshold", async () => {
    setup();
    stub({
      listItemTemplates: vi
        .fn()
        .mockResolvedValue([
          { templateId: "tmpl-mid", name: "Mid", fullName: "Project/Mid" },
        ]) as never,
      getChildren: childrenByCount({ "tmpl-mid-sec": 10 }),
    });

    // Below custom threshold 11 → no report.
    expect(await runAuditHeavyTemplates({ json: true, threshold: 11 })).toEqual([]);
    // At custom threshold 10 → flagged.
    const flagged = await runAuditHeavyTemplates({ json: true, threshold: 10 });
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.fieldCount).toBe(10);
  });

  it("sorts reports by descending field count", async () => {
    setup();
    stub({
      listItemTemplates: vi.fn().mockResolvedValue([
        { templateId: "small", name: "Small", fullName: "Project/Small" },
        { templateId: "big", name: "Big", fullName: "Project/Big" },
      ]) as never,
      getChildren: vi.fn().mockImplementation(({ itemId }: { itemId: string }) => {
        if (itemId === "small") return Promise.resolve([{ itemId: "s-sec" }]);
        if (itemId === "big") return Promise.resolve([{ itemId: "b-sec" }]);
        if (itemId === "s-sec")
          return Promise.resolve(Array.from({ length: 51 }, (_, i) => ({ itemId: `s${i}` })));
        if (itemId === "b-sec")
          return Promise.resolve(Array.from({ length: 80 }, (_, i) => ({ itemId: `b${i}` })));
        return Promise.resolve([]);
      }) as never,
    });

    const reports = await runAuditHeavyTemplates({ json: true, threshold: 50 });
    expect(reports.map((r) => r.name)).toEqual(["Big", "Small"]);
  });
});

describe("audit heavy-templates — system filter + limit", () => {
  it("excludes System/ templates by default", async () => {
    setup();
    stub({
      listItemTemplates: vi.fn().mockResolvedValue([
        { templateId: "sys", name: "SysTmpl", fullName: "System/Foundation/SysTmpl" },
        { templateId: "branch-sys", name: "BranchSys", fullName: "Branches/System/BranchSys" },
        { templateId: "proj", name: "ProjTmpl", fullName: "Project/ProjTmpl" },
      ]) as never,
      getChildren: vi.fn().mockImplementation(({ itemId }: { itemId: string }) => {
        if (itemId === "proj") return Promise.resolve([{ itemId: "proj-sec" }]);
        if (itemId === "proj-sec")
          return Promise.resolve(Array.from({ length: 60 }, (_, i) => ({ itemId: `pf${i}` })));
        return Promise.resolve([]);
      }) as never,
    });

    const reports = await runAuditHeavyTemplates({ json: true });
    // Only the Project template is scanned; System ones are filtered out.
    expect(reports).toHaveLength(1);
    expect(reports[0]!.name).toBe("ProjTmpl");
  });

  it("includes System/ templates when --include-system is set", async () => {
    setup();
    const listSpy = vi
      .fn()
      .mockResolvedValue([
        { templateId: "sys", name: "SysTmpl", fullName: "System/Foundation/SysTmpl" },
      ]);
    stub({
      listItemTemplates: listSpy as never,
      getChildren: vi.fn().mockImplementation(({ itemId }: { itemId: string }) => {
        if (itemId === "sys") return Promise.resolve([{ itemId: "sys-sec" }]);
        if (itemId === "sys-sec")
          return Promise.resolve(Array.from({ length: 55 }, (_, i) => ({ itemId: `sf${i}` })));
        return Promise.resolve([]);
      }) as never,
    });

    const reports = await runAuditHeavyTemplates({ json: true, includeSystem: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.name).toBe("SysTmpl");
  });

  it("treats a null fullName as a non-system template", async () => {
    setup();
    stub({
      listItemTemplates: vi
        .fn()
        .mockResolvedValue([{ templateId: "nf", name: "NoFullName", fullName: null }]) as never,
      getChildren: vi.fn().mockImplementation(({ itemId }: { itemId: string }) => {
        if (itemId === "nf") return Promise.resolve([{ itemId: "nf-sec" }]);
        if (itemId === "nf-sec")
          return Promise.resolve(Array.from({ length: 50 }, (_, i) => ({ itemId: `x${i}` })));
        return Promise.resolve([]);
      }) as never,
    });

    const reports = await runAuditHeavyTemplates({ json: true });
    expect(reports).toHaveLength(1);
    // formatLine falls back to name when fullName is null.
    expect(reports[0]!.fullName).toBeNull();
  });

  it("caps the candidate set at --limit", async () => {
    setup();
    const many = Array.from({ length: 5 }, (_, i) => ({
      templateId: `t${i}`,
      name: `T${i}`,
      fullName: `Project/T${i}`,
    }));
    const getChildrenSpy = vi.fn().mockResolvedValue([]);
    stub({
      listItemTemplates: vi.fn().mockResolvedValue(many) as never,
      getChildren: getChildrenSpy as never,
    });

    await runAuditHeavyTemplates({ json: true, limit: 2 });
    // Only the first 2 templates are inspected — one getChildren call each.
    expect(getChildrenSpy).toHaveBeenCalledTimes(2);
  });

  it("scans a custom --root path", async () => {
    setup();
    const listSpy = vi.fn().mockResolvedValue([]);
    stub({ listItemTemplates: listSpy as never });

    await runAuditHeavyTemplates({ json: true, root: "/sitecore/templates/Foundation" });
    expect(listSpy).toHaveBeenCalledWith({ rootPath: "/sitecore/templates/Foundation" });
  });
});

describe("audit heavy-templates — JSON envelope", () => {
  it("emits a ScaiEnvelope with count + threshold meta", async () => {
    setup();
    stub({
      listItemTemplates: vi
        .fn()
        .mockResolvedValue([
          { templateId: "tmpl-heavy", name: "Heavy", fullName: "Project/Heavy" },
        ]) as never,
      getChildren: childrenByCount({ "tmpl-heavy-sec": 60 }),
    });

    const captured: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
    try {
      await runAuditHeavyTemplates({ json: true });
    } finally {
      writeSpy.mockRestore();
    }
    const payload = JSON.parse(captured.join(""));
    expect(payload.command).toBe("audit.heavy-templates.list");
    expect(payload.count).toBe(1);
    expect(payload.meta.threshold).toBe(50);
    expect(payload.meta.scannedCount).toBe(1);
  });
});
