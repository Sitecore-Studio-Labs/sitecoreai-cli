/**
 * Coverage for `cleanup site-residue` — verifies the four safety rails:
 *   1. `--what-if` is the default behaviour; no deleteItem call fires.
 *   2. Inbound-ref pre-flight finds active-content refs into doomed
 *      trees and skips those orphans (without --force).
 *   3. `--force` overrides the ref-check skip.
 *   4. Successful `--allow-write` runs call deleteItem({permanently}).
 *
 * The audit-site-residue helper is mocked so the cleanup test focuses
 * on the cleanup-specific behaviour. The hygiene client is stubbed.
 */

import { consola } from "consola";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
vi.mock("../../../../src/hygiene/tasks/audit/site-residue", () => ({
  runAuditSiteResidue: vi.fn(),
}));
vi.mock("../../../../src/recipe/api/site-discovery", () => ({
  discoverSites: vi.fn().mockResolvedValue([
    {
      name: "content-modelling",
      displayName: "content-modelling",
      path: "/sitecore/content/demo-registry/content-modelling",
      tenantName: "demo-registry",
      tenantPath: "/sitecore/content/demo-registry",
    },
  ]),
}));
vi.mock("../../../../src/policy/allow-write", () => ({
  ensureAllowWrite: vi.fn(),
}));

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditSiteResidue } from "../../../../src/hygiene/tasks/audit/site-residue";
import { ensureAllowWrite } from "../../../../src/policy/allow-write";
import { runCleanupSiteResidue } from "../../../../src/hygiene/tasks/cleanup/site-residue";

const ORPHAN_FINDING = {
  kind: "orphan-tenant" as const,
  root: "/sitecore/templates/Project",
  tenant: "click-click-launch",
  site: null,
  itemId: "deletedtenantid",
  path: "/sitecore/templates/Project/click-click-launch",
  descendantCount: 1739,
};

const setup = (params: {
  /** Items to return when scanItemsAndFields scans active content for refs. */
  scannedItems?: Array<{ id: string; fields: Array<{ name: string; value: string }> }>;
  /** Descendant itemIds returned by `_path CONTAINS` searches. Keys are normalized parent ids. */
  descendantsByOrphan?: Record<string, string[]>;
}) => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const scannedItems = params.scannedItems ?? [];
  const fieldsMap = new Map(
    scannedItems.map((it) => [it.id, it.fields.map((f) => ({ fieldId: "f1", ...f }))])
  );
  const descendants = params.descendantsByOrphan ?? {};
  const client = {
    search: vi.fn().mockImplementation(async (input: { searchStatement?: unknown }) => {
      // Two callers: (a) scanItemsAndFields uses _fullpath EXACT for root
      // resolution; (b) the cleanup uses _path CONTAINS for descendant
      // enumeration. Distinguish by the criteria field.
      const stmt = input.searchStatement as
        | { criteria?: { field?: string; value?: string }; subStatements?: unknown[] }
        | undefined;
      const field = stmt?.criteria?.field;
      const value = stmt?.criteria?.value;
      if (field === "_fullpath") {
        // Root path resolution — return a stub root itemId.
        return { totalCount: 1, results: [{ itemId: "rootid", path: value }] };
      }
      if (field === "_path" && value) {
        const ids = descendants[value] ?? [];
        const results = ids.map((id) => ({ itemId: id, path: `/x/${id}` }));
        return { totalCount: results.length, results };
      }
      return { totalCount: 0, results: [] };
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of scannedItems) {
        yield {
          itemId: it.id,
          path: `/sitecore/content/demo-registry/content-modelling/${it.id}`,
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
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn().mockResolvedValue(undefined),
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
  vi.mocked(runAuditSiteResidue).mockResolvedValue([ORPHAN_FINDING]);
});

describe("cleanup site-residue", () => {
  it("--what-if mode never calls deleteItem", async () => {
    const client = setup({});
    const actions = await runCleanupSiteResidue({
      whatIf: true,
      skipRefCheck: true,
      json: true,
    } as never);
    expect(client.deleteItem).not.toHaveBeenCalled();
    expect(ensureAllowWrite).not.toHaveBeenCalled();
    expect(actions).toHaveLength(1);
    expect(actions[0].status).toBe("what-if");
  });

  it("--allow-write deletes via deleteItem with permanently:true", async () => {
    const client = setup({});
    const actions = await runCleanupSiteResidue({
      allowWrite: true,
      skipRefCheck: true,
      json: true,
    } as never);
    expect(ensureAllowWrite).toHaveBeenCalled();
    expect(client.deleteItem).toHaveBeenCalledWith({
      itemId: ORPHAN_FINDING.itemId,
      permanently: true,
    });
    expect(actions[0].status).toBe("deleted");
  });

  it("skips orphans with inbound refs when --force is absent", async () => {
    // Active content has an item referencing an id inside the doomed tree.
    const client = setup({
      scannedItems: [
        {
          id: "activepage",
          fields: [
            {
              name: "FooterRef",
              value: "{ABCDEF12-3456-7890-1234-567890abcdef}",
            },
          ],
        },
      ],
      descendantsByOrphan: {
        // Audit's countDescendants used `normalizeItemId(itemId)` which
        // strips dashes — but the orphan finding's itemId IS already
        // pre-normalised in our fixture ("deletedtenantid"). The ref's
        // extracted id has dashes stripped + lowercased.
        deletedtenantid: ["abcdef12345678901234567890abcdef"],
      },
    });
    const actions = await runCleanupSiteResidue({
      whatIf: true,
      json: true,
    } as never);
    expect(client.deleteItem).not.toHaveBeenCalled();
    expect(actions[0].status).toBe("skipped");
    expect(actions[0].inboundRefs).toHaveLength(1);
    expect(actions[0].inboundRefs?.[0]).toMatchObject({
      fromItemId: "activepage",
      fieldName: "FooterRef",
      refItemId: "abcdef12345678901234567890abcdef",
    });
  });

  it("--force overrides the ref-skip and deletes anyway", async () => {
    const client = setup({
      scannedItems: [
        {
          id: "activepage",
          fields: [{ name: "FooterRef", value: "{ABCDEF12-3456-7890-1234-567890abcdef}" }],
        },
      ],
      descendantsByOrphan: {
        deletedtenantid: ["abcdef12345678901234567890abcdef"],
      },
    });
    const actions = await runCleanupSiteResidue({
      allowWrite: true,
      force: true,
      json: true,
    } as never);
    expect(client.deleteItem).toHaveBeenCalledTimes(1);
    expect(actions[0].status).toBe("deleted");
    expect(actions[0].inboundRefs).toHaveLength(1);
  });

  it("--skip-ref-check omits inboundRefs and runs without scanning", async () => {
    const client = setup({
      scannedItems: [
        {
          id: "activepage",
          fields: [{ name: "FooterRef", value: "{ABCDEF12-3456-7890-1234-567890abcdef}" }],
        },
      ],
      descendantsByOrphan: {
        deletedtenantid: ["abcdef12345678901234567890abcdef"],
      },
    });
    const actions = await runCleanupSiteResidue({
      whatIf: true,
      skipRefCheck: true,
      json: true,
    } as never);
    // No ref scan ran — refs aren't surfaced even though the doomed
    // tree contains items the active page references.
    expect(actions[0].status).toBe("what-if");
    expect(actions[0].inboundRefs).toBeUndefined();
    expect(client.deleteItem).not.toHaveBeenCalled();
  });

  it("returns empty plan when audit finds no orphans", async () => {
    vi.mocked(runAuditSiteResidue).mockResolvedValueOnce([]);
    const client = setup({});
    const actions = await runCleanupSiteResidue({
      whatIf: true,
      skipRefCheck: true,
      json: true,
    } as never);
    expect(actions).toEqual([]);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });
});

describe("cleanup site-residue — failure + multi-finding + text mode", () => {
  it("captures a deleteItem failure as a failed status without aborting", async () => {
    const client = setup({});
    (client.deleteItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("server delete lock")
    );
    const actions = await runCleanupSiteResidue({
      allowWrite: true,
      skipRefCheck: true,
      json: true,
    } as never);
    expect(actions[0].status).toBe("failed");
    expect(actions[0].error).toContain("server delete lock");
  });

  it("sums descendantCount across multiple what-if findings", async () => {
    vi.mocked(runAuditSiteResidue).mockResolvedValueOnce([
      { ...ORPHAN_FINDING, itemId: "orphan1", descendantCount: 10 },
      {
        ...ORPHAN_FINDING,
        itemId: "orphan2",
        path: "/sitecore/templates/Project/other",
        descendantCount: 25,
      },
    ]);
    const client = setup({});
    const actions = await runCleanupSiteResidue({
      whatIf: true,
      skipRefCheck: true,
      json: true,
    } as never);
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.status === "what-if")).toBe(true);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });

  it("emits the what-if banner and plan summary in text mode", async () => {
    setup({});
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined as never);
    await runCleanupSiteResidue({
      whatIf: true,
      skipRefCheck: true,
    } as never);
    const text = infoSpy.mock.calls.map((c) => String(c[0])).join("\n");
    infoSpy.mockRestore();
    expect(text).toContain("What-if mode active");
    expect(text).toContain("Plan: would delete");
  });

  it("falls back to the content root when no active sites are discovered", async () => {
    const { discoverSites } = await import("../../../../src/recipe/api/site-discovery");
    vi.mocked(discoverSites).mockResolvedValueOnce([]);
    const client = setup({
      scannedItems: [
        {
          id: "activepage",
          fields: [{ name: "FooterRef", value: "{ABCDEF12-3456-7890-1234-567890abcdef}" }],
        },
      ],
      descendantsByOrphan: {
        deletedtenantid: ["abcdef12345678901234567890abcdef"],
      },
    });
    // No discovered sites → tenantRoots falls back to the content root,
    // so the ref scan still runs and finds the inbound reference.
    const actions = await runCleanupSiteResidue({
      whatIf: true,
      json: true,
    } as never);
    expect(actions[0].status).toBe("skipped");
    expect(actions[0].inboundRefs).toHaveLength(1);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });

  it("reports 'no orphan trees' in text mode when the audit is clean", async () => {
    vi.mocked(runAuditSiteResidue).mockResolvedValueOnce([]);
    setup({});
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined as never);
    const actions = await runCleanupSiteResidue({
      whatIf: true,
      skipRefCheck: true,
    } as never);
    const text = infoSpy.mock.calls.map((c) => String(c[0])).join("\n");
    infoSpy.mockRestore();
    expect(actions).toEqual([]);
    expect(text).toContain("No orphan site-residue trees found.");
  });

  it("renders the per-action formatLine in text mode (deleted + would-delete + skipped)", async () => {
    vi.mocked(runAuditSiteResidue).mockResolvedValueOnce([
      { ...ORPHAN_FINDING, itemId: "orphanA", path: "/x/A", descendantCount: 3 },
    ]);
    setup({});
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined as never);
    await runCleanupSiteResidue({
      allowWrite: true,
      skipRefCheck: true,
    } as never);
    const text = infoSpy.mock.calls.map((c) => String(c[0])).join("\n");
    infoSpy.mockRestore();
    // `printReport` formatLine renders the [deleted] prefix + descendant count.
    expect(text).toContain("[deleted] /x/A (3 items)");
  });

  it("renders the skipped formatLine with an inbound-ref tag in text mode", async () => {
    setup({
      scannedItems: [
        {
          id: "activepage",
          fields: [{ name: "FooterRef", value: "{ABCDEF12-3456-7890-1234-567890abcdef}" }],
        },
      ],
      descendantsByOrphan: {
        deletedtenantid: ["abcdef12345678901234567890abcdef"],
      },
    });
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined as never);
    await runCleanupSiteResidue({ whatIf: true } as never);
    const text = infoSpy.mock.calls.map((c) => String(c[0])).join("\n");
    infoSpy.mockRestore();
    expect(text).toContain("[skipped]");
    expect(text).toContain("inbound ref");
  });

  it("paginates the descendant search across multiple full pages", async () => {
    const client = setup({});
    // First _path search page returns a full 500-id page, the second a
    // short page — exercising the `results.length < pageSize` break.
    const fullPage = Array.from({ length: 500 }, (_, i) => `desc${i}`);
    let pathSearchCalls = 0;
    (client.search as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { searchStatement?: unknown }) => {
        const stmt = input.searchStatement as
          | { criteria?: { field?: string; value?: string } }
          | undefined;
        const fieldName = stmt?.criteria?.field;
        const value = stmt?.criteria?.value;
        if (fieldName === "_fullpath") {
          return { totalCount: 1, results: [{ itemId: "rootid", path: value }] };
        }
        if (fieldName === "_path") {
          pathSearchCalls += 1;
          if (pathSearchCalls === 1) {
            return {
              totalCount: 500,
              results: fullPage.map((id) => ({ itemId: id, path: `/x/${id}` })),
            };
          }
          return { totalCount: 501, results: [{ itemId: "descLast", path: "/x/last" }] };
        }
        return { totalCount: 0, results: [] };
      }
    );
    const actions = await runCleanupSiteResidue({
      whatIf: true,
      json: true,
    } as never);
    // Two _path search pages were walked for the single orphan.
    expect(pathSearchCalls).toBeGreaterThanOrEqual(2);
    expect(actions[0].status).toBe("what-if");
  });

  it("captures a deleteItem failure and renders the [failed] line in text mode", async () => {
    const client = setup({});
    (client.deleteItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("delete denied")
    );
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined as never);
    const actions = await runCleanupSiteResidue({
      allowWrite: true,
      skipRefCheck: true,
    } as never);
    const text = infoSpy.mock.calls.map((c) => String(c[0])).join("\n");
    infoSpy.mockRestore();
    expect(actions[0].status).toBe("failed");
    expect(text).toContain("[failed]");
    expect(text).toContain("delete denied");
  });
});
