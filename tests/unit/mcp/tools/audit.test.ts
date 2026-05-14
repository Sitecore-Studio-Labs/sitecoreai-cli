import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const hygieneMocks = vi.hoisted(() => ({
  auditNames: vi.fn(() => [
    "alt-text-missing",
    "broken-images",
    "broken-links",
    "datasource-missing",
    "dead-templates",
    "duplicates",
    "empty-items",
    "empty-links",
    "empty-roles",
    "fallback-drift",
    "find-replace",
    "heavy-templates",
    "language-data",
    "large-fields",
    "missing-meta",
    "orphans",
    "page-design-orphans",
    "personalization-broken",
    "role-bloat",
    "site-residue",
    "slug-conflicts",
    "stale-content",
    "stale-users",
    "stale-workflow",
    "translation-coverage",
    "unused-media",
  ]),
  // One mock per single-audit runner. They all resolve to the same empty
  // findings array — the dispatch path is what we're exercising.
  runAuditAll: vi.fn().mockResolvedValue(undefined),
  runAuditAltTextMissing: vi.fn().mockResolvedValue([]),
  runAuditBrokenImages: vi.fn().mockResolvedValue([]),
  runAuditBrokenLinks: vi.fn().mockResolvedValue([]),
  runAuditDatasourceMissing: vi.fn().mockResolvedValue([]),
  runAuditDeadTemplates: vi.fn().mockResolvedValue([]),
  runAuditDuplicates: vi.fn().mockResolvedValue([]),
  runAuditEmptyItems: vi.fn().mockResolvedValue([]),
  runAuditEmptyLinks: vi.fn().mockResolvedValue([]),
  runAuditEmptyRoles: vi.fn().mockResolvedValue([]),
  runAuditFallbackDrift: vi.fn().mockResolvedValue([]),
  runAuditFindReplace: vi.fn().mockResolvedValue([]),
  runAuditHeavyTemplates: vi.fn().mockResolvedValue([]),
  runAuditLanguageData: vi.fn().mockResolvedValue([]),
  runAuditLargeFields: vi.fn().mockResolvedValue([]),
  runAuditMissingMeta: vi.fn().mockResolvedValue([]),
  runAuditOrphans: vi.fn().mockResolvedValue([]),
  runAuditPageDesignOrphans: vi.fn().mockResolvedValue([]),
  runAuditPersonalizationBroken: vi.fn().mockResolvedValue([]),
  runAuditRoleBloat: vi.fn().mockResolvedValue([]),
  runAuditSiteResidue: vi.fn().mockResolvedValue([]),
  runAuditSlugConflicts: vi.fn().mockResolvedValue([]),
  runAuditStaleContent: vi.fn().mockResolvedValue([]),
  runAuditStaleUsers: vi.fn().mockResolvedValue([]),
  runAuditStaleWorkflow: vi.fn().mockResolvedValue([]),
  runAuditTranslationCoverage: vi.fn().mockResolvedValue([]),
  runAuditUnusedMedia: vi.fn().mockResolvedValue([]),
  runAuditSuiteRun: vi.fn().mockResolvedValue(undefined),
  runBaselineCreate: vi.fn().mockResolvedValue(undefined),
  runBaselineRemove: vi.fn().mockResolvedValue(undefined),
  runBaselineReset: vi.fn().mockResolvedValue(undefined),
  runBaselineShow: vi.fn().mockResolvedValue(undefined),
  runHistoryCapture: vi.fn().mockResolvedValue(undefined),
  runHistoryList: vi.fn().mockResolvedValue(undefined),
}));

const baselineMocks = vi.hoisted(() => ({
  openBaseline: vi.fn().mockReturnValue({
    filePath: "/tmp/.scai/audit-baseline-test-env.json",
    snapshot: () => ({ ignored: {} }),
  }),
}));

const historyMocks = vi.hoisted(() => ({
  listHistory: vi.fn(() => []),
  loadSnapshot: vi.fn(),
  diffSnapshots: vi.fn(() => ({ totals: { added: 0, removed: 0, net: 0 } })),
}));

vi.mock("../../../../src/hygiene/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/tasks")>();
  return { ...actual, ...hygieneMocks };
});
vi.mock("../../../../src/hygiene/baseline", () => ({ ...baselineMocks }));
vi.mock("../../../../src/hygiene/history", () => ({ ...historyMocks }));

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp/sitecoreai.cli.json",
  resolved: {
    envName: "test-env",
    environment: {} as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "tok",
};

const fakeExtra = {
  signal: new AbortController().signal,
  progressToken: undefined,
  sendProgress: async () => undefined,
  sendNotification: async () => undefined,
};

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

describe("audit_inspect — verb routing", () => {
  it("verb='list' returns the registry of audit names", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("audit_inspect")!
      .handler({ verb: "list" }, fakeContext, fakeExtra);
    const structured = result.structuredContent as { audits: string[] };
    expect(structured.audits.length).toBeGreaterThan(0);
    expect(structured.audits).toContain("site-residue");
  });

  it("verb='run' requires an `audit` field", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("audit_inspect")!.handler({ verb: "run" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='run' rejects unknown audit names", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("audit_inspect")!
        .handler({ verb: "run", audit: "not-a-real-audit" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='run' dispatches site-residue (regression: was missing from the routing table)", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("audit_inspect")!
      .handler({ verb: "run", audit: "site-residue" }, fakeContext, fakeExtra);
    expect(hygieneMocks.runAuditSiteResidue).toHaveBeenCalled();
    const structured = result.structuredContent as { audit: string; count: number };
    expect(structured.audit).toBe("site-residue");
    expect(structured.count).toBe(0);
  });

  it("verb='run' for site-residue does NOT forward top-level `root` (string conflicts with library's string[] shape)", async () => {
    const reg = await setup();
    await reg.getTool("audit_inspect")!.handler(
      {
        verb: "run",
        audit: "site-residue",
        // Top-level root would normally flow into the runner. For
        // site-residue we must drop it — its library option is
        // `root?: string[]` and a string would spread as characters.
        root: "/sitecore/content/MySite",
        auditOptions: { root: ["/sitecore/templates/Project"] },
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runAuditSiteResidue.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.root).toEqual(["/sitecore/templates/Project"]);
  });

  it("verb='run' for non-site-residue audits forwards the top-level root", async () => {
    const reg = await setup();
    await reg.getTool("audit_inspect")!.handler(
      {
        verb: "run",
        audit: "broken-links",
        root: "/sitecore/content/MySite",
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runAuditBrokenLinks.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.root).toBe("/sitecore/content/MySite");
  });
});

describe("audit_inspect — CLI/MCP parity", () => {
  it("every name returned by verb='list' is dispatchable by verb='run'", async () => {
    const reg = await setup();
    const listResult = await reg
      .getTool("audit_inspect")!
      .handler({ verb: "list" }, fakeContext, fakeExtra);
    const names = (listResult.structuredContent as { audits: string[] }).audits;

    // Every name registered in auditNames() must be reachable via the
    // dispatch table. The previous bug: site-residue was in auditNames()
    // but not in SINGLE_AUDIT_RUNNERS, so verb='run' would throw
    // "Unknown audit 'site-residue'". This parity test guards against
    // future drift.
    for (const name of names) {
      await expect(
        reg.getTool("audit_inspect")!.handler({ verb: "run", audit: name }, fakeContext, fakeExtra),
        `audit '${name}' should be dispatchable`
      ).resolves.toBeDefined();
    }
  });
});

describe("audit_baseline — verb routing", () => {
  it("verb='show' returns the baseline file path", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("audit_baseline")!
      .handler({ verb: "show" }, fakeContext, fakeExtra);
    const structured = result.structuredContent as { filePath: string };
    expect(structured.filePath).toContain("audit-baseline");
  });

  it("verb='remove' requires audit + fingerprint", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("audit_baseline")!
        .handler({ verb: "remove", audit: "broken-links" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='reset' clears one audit's entries when audit is named", async () => {
    const reg = await setup();
    await reg
      .getTool("audit_baseline")!
      .handler({ verb: "reset", audit: "broken-links" }, fakeContext, fakeExtra);
    expect(hygieneMocks.runBaselineReset).toHaveBeenCalled();
  });
});

describe("audit_suite_run", () => {
  it("forwards the suite file path to the runner", async () => {
    const reg = await setup();
    await reg
      .getTool("audit_suite_run")!
      .handler({ file: "/tmp/suite.yaml" }, fakeContext, fakeExtra);
    const call = hygieneMocks.runAuditSuiteRun.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.file).toBe("/tmp/suite.yaml");
  });
});
