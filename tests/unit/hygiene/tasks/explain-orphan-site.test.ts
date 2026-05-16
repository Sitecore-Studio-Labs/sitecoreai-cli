/**
 * `runExplainOrphanSite` composes `audit site-residue` and `audit
 * references`: it filters residue to the named site, counts inbound
 * references to each orphan tree, and flags the still-referenced ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auditSiteResidueMock = vi.hoisted(() => vi.fn());
const auditReferencesMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/hygiene/tasks/audit/site-residue", () => ({
  runAuditSiteResidue: auditSiteResidueMock,
}));
vi.mock("../../../../src/hygiene/tasks/audit/references", () => ({
  runAuditReferences: auditReferencesMock,
}));

const sharedMocks = vi.hoisted(() => ({
  resolveTenant: vi.fn(),
  toLogger: vi.fn(),
  printReport: vi.fn(),
}));
vi.mock("../../../../src/hygiene/tasks/shared", () => sharedMocks);

import { runExplainOrphanSite } from "../../../../src/hygiene/tasks/explain/orphan-site";

const residueEntry = (over: Record<string, unknown>) => ({
  kind: "orphan-site",
  root: "/sitecore/templates/Project",
  tenant: "Acme",
  site: "Marketing",
  itemId: "aaa00000000000000000000000000000",
  path: "/sitecore/templates/Project/Acme/Marketing",
  descendantCount: 4,
  ...over,
});

const setupTenant = () => {
  sharedMocks.resolveTenant.mockReturnValue({
    envName: "demo",
    client: {} as never,
    environment: {} as never,
    rootConfig: {} as never,
  });
  sharedMocks.toLogger.mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    verbose: vi.fn(),
    isJson: () => true,
    json: vi.fn(),
  });
};

describe("runExplainOrphanSite", () => {
  beforeEach(() => {
    auditSiteResidueMock.mockReset();
    auditReferencesMock.mockReset();
    sharedMocks.resolveTenant.mockReset();
    sharedMocks.toLogger.mockReset();
    sharedMocks.printReport.mockReset();
  });

  it("rejects when <site> is missing", async () => {
    setupTenant();
    await expect(runExplainOrphanSite({} as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("filters residue to the named site and counts inbound references per orphan", async () => {
    setupTenant();
    auditSiteResidueMock.mockResolvedValueOnce([
      residueEntry({ site: "Marketing", itemId: "m1", path: "/templates/Acme/Marketing" }),
      residueEntry({ site: "Marketing", itemId: "m2", path: "/layout/Acme/Marketing" }),
      residueEntry({ site: "Other", itemId: "o1", path: "/templates/Acme/Other" }),
    ]);
    // m1 → 2 inbound matches, m2 → none.
    auditReferencesMock
      .mockResolvedValueOnce([{ matches: [{ fieldName: "A" }, { fieldName: "B" }] }])
      .mockResolvedValueOnce([]);

    const report = await runExplainOrphanSite({ site: "Marketing" } as never);

    expect(report.site).toBe("Marketing");
    expect(report.orphans).toHaveLength(2);
    // Referenced orphan sorts first.
    expect(report.orphans[0].itemId).toBe("m1");
    expect(report.orphans[0].inboundRefs).toBe(2);
    expect(report.orphans[1].inboundRefs).toBe(0);
    // `Other` was filtered out — references ran only for the two matches.
    expect(auditReferencesMock).toHaveBeenCalledTimes(2);
  });

  it("emits an empty report when no residue matches the site", async () => {
    setupTenant();
    auditSiteResidueMock.mockResolvedValueOnce([residueEntry({ site: "Other" })]);

    const report = await runExplainOrphanSite({ site: "Marketing" } as never);

    expect(report.orphans).toHaveLength(0);
    expect(auditReferencesMock).not.toHaveBeenCalled();
    expect(sharedMocks.printReport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "explain.orphan-site",
        summary: expect.stringContaining("No orphan residue"),
      })
    );
  });

  it("runs both audits with `silent: true` so the verb owns the report", async () => {
    setupTenant();
    auditSiteResidueMock.mockResolvedValueOnce([residueEntry({})]);
    auditReferencesMock.mockResolvedValueOnce([]);

    await runExplainOrphanSite({ site: "Marketing" } as never);

    expect(auditSiteResidueMock).toHaveBeenCalledWith(expect.objectContaining({ silent: true }));
    expect(auditReferencesMock).toHaveBeenCalledWith(expect.objectContaining({ silent: true }));
  });
});
