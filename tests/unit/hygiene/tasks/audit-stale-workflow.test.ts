/**
 * `scai hygiene audit stale-workflow list` — flags items stuck in a
 * non-final workflow state whose last update is older than --days N.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditStaleWorkflow } from "../../../../src/hygiene/tasks/audit/stale-workflow";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
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
}

/**
 * Install a fake hygiene client. `rows` are the search-index hits;
 * `workflowByItem` maps itemId → the `getItemWorkflow` result (or
 * undefined for "no workflow").
 */
const setup = (
  rows: IndexRow[],
  workflowByItem: Record<
    string,
    { workflowName?: string | null; stateName?: string | null; stateIsFinal?: boolean } | undefined
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
          updatedDate: r.updatedDate === undefined ? daysAgo(60) : r.updatedDate,
        };
      }
    }),
    getItemWorkflow: vi.fn(async (itemId: string) => {
      const wf = workflowByItem[itemId];
      if (!wf) return null;
      return {
        itemId,
        path: null,
        workflowId: "w1",
        workflowName: wf.workflowName ?? "Editorial",
        stateId: "s1",
        stateName: wf.stateName ?? "Draft",
        stateIsFinal: wf.stateIsFinal ?? false,
      };
    }),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit stale-workflow — candidate filtering", () => {
  it("returns an empty report when no items are in a non-final workflow", async () => {
    setup([{ id: "abc1", path: "/sitecore/content/A" }], {});
    const reports = await runAuditStaleWorkflow({ json: true });
    expect(reports).toEqual([]);
  });

  it("flags an item stuck in a non-final workflow state past the cutoff", async () => {
    setup([{ id: "abcdef0123456789abcdef0123456789", path: "/sitecore/content/A" }], {
      abcdef0123456789abcdef0123456789: { workflowName: "Editorial", stateName: "Draft" },
    });

    const reports = await runAuditStaleWorkflow({ json: true, days: 30 });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      path: "/sitecore/content/A",
      workflowName: "Editorial",
      stateName: "Draft",
      stateIsFinal: false,
    });
    expect(reports[0].daysSinceUpdate).toBeGreaterThanOrEqual(30);
  });

  it("excludes items updated more recently than --days", async () => {
    setup(
      [
        {
          id: "fresh01234567890abcdef0123456789a",
          path: "/sitecore/content/Fresh",
          updatedDate: daysAgo(5),
        },
      ],
      { fresh01234567890abcdef0123456789a: { stateName: "Draft" } }
    );

    const reports = await runAuditStaleWorkflow({ json: true, days: 30 });
    expect(reports).toEqual([]);
  });

  it("excludes items already in a final workflow state", async () => {
    setup([{ id: "approved123456789abcdef0123456789", path: "/sitecore/content/Done" }], {
      approved123456789abcdef0123456789: {
        workflowName: "Editorial",
        stateName: "Approved",
        stateIsFinal: true,
      },
    });

    const reports = await runAuditStaleWorkflow({ json: true, days: 30 });
    expect(reports).toEqual([]);
  });

  it("excludes items with no indexed updatedDate", async () => {
    setup(
      [{ id: "noupdate23456789abcdef0123456789a", path: "/sitecore/content/X", updatedDate: null }],
      { noupdate23456789abcdef0123456789a: { stateName: "Draft" } }
    );

    const reports = await runAuditStaleWorkflow({ json: true, days: 30 });
    expect(reports).toEqual([]);
  });

  it("skips /sitecore/system items by default", async () => {
    setup([{ id: "sys01234567890abcdef01234567890ab", path: "/sitecore/system/Settings" }], {
      sys01234567890abcdef01234567890ab: { stateName: "Draft" },
    });

    const reports = await runAuditStaleWorkflow({ json: true, days: 30 });
    expect(reports).toEqual([]);
  });

  it("includes system items when --include-system is set", async () => {
    setup([{ id: "sys01234567890abcdef01234567890ab", path: "/sitecore/system/Settings" }], {
      sys01234567890abcdef01234567890ab: { stateName: "Draft" },
    });

    const reports = await runAuditStaleWorkflow({ json: true, days: 30, includeSystem: true });
    expect(reports).toHaveLength(1);
  });

  it("sorts the report by daysSinceUpdate descending", async () => {
    setup(
      [
        {
          id: "olde0123456789abcdef0123456789ab",
          path: "/sitecore/content/Old",
          updatedDate: daysAgo(120),
        },
        {
          id: "newr0123456789abcdef0123456789ab",
          path: "/sitecore/content/New",
          updatedDate: daysAgo(45),
        },
      ],
      {
        olde0123456789abcdef0123456789ab: { stateName: "Draft" },
        newr0123456789abcdef0123456789ab: { stateName: "Draft" },
      }
    );

    const reports = await runAuditStaleWorkflow({ json: true, days: 30 });

    expect(reports.map((r) => r.path)).toEqual(["/sitecore/content/Old", "/sitecore/content/New"]);
  });

  it("caps candidates at --limit", async () => {
    const rows: IndexRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `item${i}0123456789abcdef0123456789ab`.slice(0, 32),
      path: `/sitecore/content/Item${i}`,
    }));
    const wf = Object.fromEntries(rows.map((r) => [r.id, { stateName: "Draft" }]));
    setup(rows, wf);

    const reports = await runAuditStaleWorkflow({ json: true, days: 30, limit: 2 });
    expect(reports).toHaveLength(2);
  });
});
