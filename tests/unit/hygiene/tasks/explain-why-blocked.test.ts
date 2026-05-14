/**
 * `runExplainWhyBlocked` composes `audit references` and `audit
 * template-dependencies` into a single sorted-by-kind blocker list.
 * These tests pin the merge + sort behavior and the skip flags.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auditReferencesMock = vi.hoisted(() => vi.fn());
const auditTemplateDependenciesMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/hygiene/tasks/audit-references", () => ({
  runAuditReferences: auditReferencesMock,
}));
vi.mock("../../../../src/hygiene/tasks/audit-template-dependencies", () => ({
  runAuditTemplateDependencies: auditTemplateDependenciesMock,
}));

const sharedMocks = vi.hoisted(() => ({
  resolveTenant: vi.fn(),
  toLogger: vi.fn(),
  printReport: vi.fn(),
  normalizeItemId: (raw: string): string => raw.toLowerCase().replace(/[{}-]/g, ""),
}));

vi.mock("../../../../src/hygiene/tasks/shared", () => sharedMocks);

import { runExplainWhyBlocked } from "../../../../src/hygiene/tasks/explain-why-blocked";

const GUID = "abcdef0123456789abcdef0123456789";

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

describe("runExplainWhyBlocked", () => {
  beforeEach(() => {
    auditReferencesMock.mockReset();
    auditTemplateDependenciesMock.mockReset();
    sharedMocks.resolveTenant.mockReset();
    sharedMocks.toLogger.mockReset();
    sharedMocks.printReport.mockReset();
  });

  it("rejects when --itemId is missing", async () => {
    setupTenant();
    auditReferencesMock.mockResolvedValueOnce([]);
    auditTemplateDependenciesMock.mockResolvedValueOnce([]);
    await expect(runExplainWhyBlocked({} as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("merges field-value and template-dependency findings into one list", async () => {
    setupTenant();
    auditReferencesMock.mockResolvedValueOnce([
      {
        itemId: "fff00000000000000000000000000000",
        path: "/sitecore/content/Home",
        templateName: "Page",
        language: "en",
        matches: [
          { fieldName: "RelatedItems", form: "curly-upper" },
          { fieldName: "Body", form: "flat" },
        ],
      },
    ]);
    auditTemplateDependenciesMock.mockResolvedValueOnce([
      {
        itemId: "eee00000000000000000000000000000",
        path: "/sitecore/templates/Project/Inheritor",
        name: "Inheritor",
        templateId: null,
        templateName: null,
        referenceKind: "base-template",
      },
    ]);

    const report = await runExplainWhyBlocked({ itemId: GUID } as never);

    expect(report.itemId).toBe(GUID);
    expect(report.blockers).toHaveLength(3);
    // base-template sorts first per REFERENCE_KIND_PRIORITY.
    expect(report.blockers[0].referenceKind).toBe("base-template");
    expect(report.blockers[0].source).toBe("audit-template-dependencies");
    expect(report.blockers[1].referenceKind).toBe("field-value");
    expect(report.blockers[2].referenceKind).toBe("field-value");
  });

  it("--skip-content-scan does not call audit references", async () => {
    setupTenant();
    auditTemplateDependenciesMock.mockResolvedValueOnce([]);
    auditReferencesMock.mockClear();
    await runExplainWhyBlocked({ itemId: GUID, skipContentScan: true } as never);
    expect(auditReferencesMock).not.toHaveBeenCalled();
    expect(auditTemplateDependenciesMock).toHaveBeenCalledTimes(1);
  });

  it("--skip-template-deps does not call audit template-dependencies", async () => {
    setupTenant();
    auditReferencesMock.mockResolvedValueOnce([]);
    auditTemplateDependenciesMock.mockClear();
    await runExplainWhyBlocked({ itemId: GUID, skipTemplateDeps: true } as never);
    expect(auditTemplateDependenciesMock).not.toHaveBeenCalled();
    expect(auditReferencesMock).toHaveBeenCalledTimes(1);
  });

  it("emits an empty-blocker report when no inbound references exist", async () => {
    setupTenant();
    auditReferencesMock.mockResolvedValueOnce([]);
    auditTemplateDependenciesMock.mockResolvedValueOnce([]);

    const report = await runExplainWhyBlocked({ itemId: GUID } as never);
    expect(report.blockers).toHaveLength(0);
    expect(sharedMocks.printReport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "explain.why-blocked",
        summary: expect.stringContaining("No inbound references"),
      })
    );
  });

  it("calls both audits with `silent: true` so the verb owns the printed report", async () => {
    setupTenant();
    auditReferencesMock.mockResolvedValueOnce([]);
    auditTemplateDependenciesMock.mockResolvedValueOnce([]);
    await runExplainWhyBlocked({ itemId: GUID } as never);
    expect(auditReferencesMock).toHaveBeenCalledWith(expect.objectContaining({ silent: true }));
    expect(auditTemplateDependenciesMock).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true })
    );
  });
});
