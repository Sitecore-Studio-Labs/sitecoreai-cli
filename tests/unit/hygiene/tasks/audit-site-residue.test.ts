/**
 * Coverage for the site-residue audit — orphan SXA tenant/site folders
 * left behind by Sites-API deletes that don't cascade. Active sites
 * are mocked via the `discoverSites` helper, and the hygiene client is
 * stubbed with synthetic tenant/site folders under each SXA root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
vi.mock("../../../../src/recipe/api/site-discovery", () => ({
  discoverSites: vi.fn(),
}));

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { discoverSites } from "../../../../src/recipe/api/site-discovery";
import { runAuditSiteResidue } from "../../../../src/hygiene/tasks/audit/site-residue";

type Child = { itemId: string; name: string; path: string };
type Childs = Record<string, Child[]>;

const setup = (params: {
  activeSites: Array<{ tenantName: string; name: string }>;
  /** Children keyed by parent (path for top-level roots, itemId for tenants). */
  childrenByPath?: Record<string, Child[]>;
  childrenByItemId?: Record<string, Child[]>;
  /** Descendant counts keyed by itemId (totalCount from `_path CONTAINS itemId`). */
  descendantsByItemId?: Record<string, number>;
}) => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  vi.mocked(discoverSites).mockResolvedValue(
    params.activeSites.map((s) => ({
      name: s.name,
      displayName: s.name,
      path: `/sitecore/content/${s.tenantName}/${s.name}`,
      tenantName: s.tenantName,
      tenantPath: `/sitecore/content/${s.tenantName}`,
    }))
  );
  const byPath: Childs = params.childrenByPath ?? {};
  const byId: Childs = params.childrenByItemId ?? {};
  // The audit normalises itemIds (lowercase, strip `{}-`) before they
  // hit the search index. Rekey the counts map on the same shape so
  // tests can use human-readable IDs like `"site-orphan"`.
  const normalize = (raw: string): string => raw.toLowerCase().replace(/[{}-]/g, "");
  const counts: Record<string, number> = {};
  for (const [id, count] of Object.entries(params.descendantsByItemId ?? {})) {
    counts[normalize(id)] = count;
  }
  const client = {
    search: vi.fn().mockImplementation(async (input: { searchStatement?: unknown }) => {
      const stmt = input.searchStatement as { criteria?: { value?: string } } | undefined;
      const itemId = stmt?.criteria?.value;
      // +1 because the audit subtracts 1 to exclude the item itself.
      const total = itemId ? (counts[itemId] ?? 0) + 1 : 0;
      return { totalCount: total, results: [] };
    }),
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
    listItemTemplates: vi.fn(),
    getChildren: vi
      .fn()
      .mockImplementation(async (selector: { path?: string; itemId?: string }) => {
        if (selector.path && byPath[selector.path]) return byPath[selector.path];
        if (selector.itemId && byId[selector.itemId]) return byId[selector.itemId];
        return [];
      }),
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

describe("audit site-residue", () => {
  it("flags a tenant folder that has no active site under any SXA root", async () => {
    setup({
      activeSites: [{ tenantName: "demo-registry", name: "content-modelling" }],
      childrenByPath: {
        "/sitecore/templates/Project": [
          {
            itemId: "deleted-tenant-id",
            name: "click-click-launch",
            path: "/sitecore/templates/Project/click-click-launch",
          },
        ],
      },
      descendantsByItemId: { "deleted-tenant-id": 1739 },
    });
    const result = await runAuditSiteResidue({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "orphan-tenant",
      root: "/sitecore/templates/Project",
      tenant: "click-click-launch",
      site: null,
      descendantCount: 1739,
    });
  });

  it("flags individual orphan sites under an active tenant", async () => {
    setup({
      activeSites: [{ tenantName: "demo-registry", name: "content-modelling" }],
      childrenByPath: {
        "/sitecore/layout/Renderings/Project": [
          {
            itemId: "tenant-id",
            name: "demo-registry",
            path: "/sitecore/layout/Renderings/Project/demo-registry",
          },
        ],
      },
      childrenByItemId: {
        "tenant-id": [
          {
            itemId: "site-active",
            name: "content-modelling",
            path: "/sitecore/layout/Renderings/Project/demo-registry/content-modelling",
          },
          {
            itemId: "site-orphan",
            name: "old-experiment",
            path: "/sitecore/layout/Renderings/Project/demo-registry/old-experiment",
          },
        ],
      },
      descendantsByItemId: { "site-orphan": 222 },
    });
    const result = await runAuditSiteResidue({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "orphan-site",
      tenant: "demo-registry",
      site: "old-experiment",
      descendantCount: 222,
    });
  });

  it("matches active sites case-insensitively (tenant + site)", async () => {
    setup({
      activeSites: [{ tenantName: "Demo-Registry", name: "Content-Modelling" }],
      childrenByPath: {
        "/sitecore/templates/Project": [
          {
            itemId: "t1",
            name: "demo-registry",
            path: "/sitecore/templates/Project/demo-registry",
          },
        ],
      },
      childrenByItemId: {
        t1: [
          {
            itemId: "s1",
            name: "content-modelling",
            path: "/sitecore/templates/Project/demo-registry/content-modelling",
          },
        ],
      },
    });
    const result = await runAuditSiteResidue({ json: true } as never);
    expect(result).toHaveLength(0);
  });

  it("skips a root that throws on getChildren rather than aborting the whole audit", async () => {
    const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
    vi.mocked(resolveEnvironment).mockReturnValue({
      envName: "sandbox",
      environment: env,
      root: { environments: { sandbox: env } } as unknown as RootConfiguration,
      timeoutMs: undefined,
    });
    vi.mocked(discoverSites).mockResolvedValue([
      {
        name: "content-modelling",
        displayName: "content-modelling",
        path: "/sitecore/content/demo-registry/content-modelling",
        tenantName: "demo-registry",
        tenantPath: "/sitecore/content/demo-registry",
      },
    ]);
    const client = {
      search: vi.fn().mockResolvedValue({ totalCount: 1, results: [] }),
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
      listItemTemplates: vi.fn(),
      getChildren: vi.fn().mockImplementation(async (selector: { path?: string }) => {
        if (selector.path === "/sitecore/templates/Project") {
          throw new Error("network burp");
        }
        return [];
      }),
      updateItemFields: vi.fn(),
      listUsers: vi.fn(),
      listRoles: vi.fn(),
      getUserDetail: vi.fn(),
    } as unknown as HygieneApiClient;
    vi.mocked(createHygieneApiClient).mockReturnValue(client);
    const result = await runAuditSiteResidue({ json: true } as never);
    // No orphans found; failure on one root doesn't propagate.
    expect(result).toHaveLength(0);
  });

  it("scans extra roots passed via --root in addition to the SXA defaults", async () => {
    setup({
      activeSites: [{ tenantName: "demo-registry", name: "content-modelling" }],
      childrenByPath: {
        "/custom/audit/root": [
          {
            itemId: "custom-orphan",
            name: "click-click-launch",
            path: "/custom/audit/root/click-click-launch",
          },
        ],
      },
      descendantsByItemId: { "custom-orphan": 10 },
    });
    const result = await runAuditSiteResidue({
      json: true,
      root: ["/custom/audit/root"],
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].root).toBe("/custom/audit/root");
  });
});
