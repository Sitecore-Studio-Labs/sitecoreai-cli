/**
 * `scai hygiene audit stale-content list` — flags items not updated in
 * N days, optionally excluding items in an active workflow.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditStaleContent } from "../../../../src/hygiene/tasks/audit/stale-content";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY).toISOString();

interface IndexRow {
  id: string;
  path: string;
  updatedDate?: string | null;
  createdDate?: string | null;
}

/**
 * `workflowByItem` maps normalized itemId → the workflow object that
 * `getItemWorkflow` should return (or undefined for "no workflow").
 */
const setup = (
  rows: IndexRow[],
  workflowByItem: Record<
    string,
    { workflowName?: string; stateName?: string; stateIsFinal?: boolean } | undefined
  > = {}
): HygieneApiClient => {
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
          language: { name: "en" },
          version: 1,
          updatedDate: r.updatedDate,
          createdDate: r.createdDate ?? null,
        };
      }
    }),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn().mockImplementation((itemId: string) => {
      return Promise.resolve(workflowByItem[itemId] ?? null);
    }),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit stale-content — report shape", () => {
  it("returns empty when every item was updated recently", async () => {
    setup([{ id: "a", path: "/sitecore/content/a", updatedDate: daysAgo(10) }]);
    const reports = await runAuditStaleContent({ json: true });
    expect(reports).toEqual([]);
  });

  it("flags an item not updated within the default 365-day window", async () => {
    setup([{ id: "a", path: "/sitecore/content/a", updatedDate: daysAgo(400) }]);
    const reports = await runAuditStaleContent({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].itemId).toBe("a");
    expect(reports[0].daysSinceUpdate).toBeGreaterThanOrEqual(399);
  });

  it("honors --not-updated-in-days for a tighter cutoff", async () => {
    setup([
      { id: "fresh", path: "/sitecore/content/fresh", updatedDate: daysAgo(20) },
      { id: "stale", path: "/sitecore/content/stale", updatedDate: daysAgo(120) },
    ]);
    const reports = await runAuditStaleContent({ json: true, notUpdatedInDays: 90 });
    expect(reports.map((r) => r.itemId)).toEqual(["stale"]);
  });

  it("skips items with no updatedDate (cannot be assessed as stale)", async () => {
    setup([{ id: "a", path: "/sitecore/content/a", updatedDate: null }]);
    const reports = await runAuditStaleContent({ json: true });
    expect(reports).toEqual([]);
  });

  it("excludes items in an active (non-final) workflow by default", async () => {
    setup([{ id: "a", path: "/sitecore/content/a", updatedDate: daysAgo(400) }], {
      a: { workflowName: "Sample Workflow", stateName: "Draft", stateIsFinal: false },
    });
    const reports = await runAuditStaleContent({ json: true });
    expect(reports).toEqual([]);
  });

  it("includes items in a FINAL workflow state and surfaces the state name", async () => {
    setup([{ id: "a", path: "/sitecore/content/a", updatedDate: daysAgo(400) }], {
      a: { workflowName: "Sample Workflow", stateName: "Published", stateIsFinal: true },
    });
    const reports = await runAuditStaleContent({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].workflowState).toBe("Published");
  });

  it("keeps in-workflow items when --exclude-workflow-items is false", async () => {
    setup([{ id: "a", path: "/sitecore/content/a", updatedDate: daysAgo(400) }], {
      a: { workflowName: "Sample Workflow", stateName: "Draft", stateIsFinal: false },
    });
    const reports = await runAuditStaleContent({ json: true, excludeWorkflowItems: false });
    expect(reports).toHaveLength(1);
    // No workflow check ran, so workflowState stays null.
    expect(reports[0].workflowState).toBeNull();
  });

  it("sorts the report by daysSinceUpdate descending", async () => {
    setup([
      { id: "newer", path: "/sitecore/content/newer", updatedDate: daysAgo(400) },
      { id: "older", path: "/sitecore/content/older", updatedDate: daysAgo(900) },
    ]);
    const reports = await runAuditStaleContent({ json: true });
    expect(reports.map((r) => r.itemId)).toEqual(["older", "newer"]);
  });

  it("excludes /sitecore/system items by default", async () => {
    setup([{ id: "sys", path: "/sitecore/system/Settings", updatedDate: daysAgo(900) }]);
    const reports = await runAuditStaleContent({ json: true });
    expect(reports).toEqual([]);
  });

  it("emits a JSON envelope to stdout under --json", async () => {
    setup([{ id: "a", path: "/sitecore/content/a", updatedDate: daysAgo(400) }]);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runAuditStaleContent({ json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.stale-content.list");
    expect(parsed.count).toBe(1);
    expect(parsed.meta.notUpdatedInDays).toBe(365);
  });
});

describe("audit stale-content — error paths", () => {
  it("propagates an error thrown by resolveTenant", async () => {
    vi.mocked(resolveEnvironment).mockImplementation(() => {
      throw Object.assign(new Error("env fail"), { code: "CONFIG_NOT_FOUND" });
    });
    await expect(runAuditStaleContent({ json: true })).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });
  });
});
