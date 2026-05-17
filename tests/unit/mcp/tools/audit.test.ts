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

vi.mock("../../../../src/hygiene/tasks/audit/all", () => ({
  auditNames: hygieneMocks.auditNames,
  runAuditAll: hygieneMocks.runAuditAll,
}));
vi.mock("../../../../src/hygiene/tasks/audit/alt-text-missing", () => ({
  runAuditAltTextMissing: hygieneMocks.runAuditAltTextMissing,
}));
vi.mock("../../../../src/hygiene/tasks/audit/broken-images", () => ({
  runAuditBrokenImages: hygieneMocks.runAuditBrokenImages,
}));
vi.mock("../../../../src/hygiene/tasks/audit/broken-links", () => ({
  runAuditBrokenLinks: hygieneMocks.runAuditBrokenLinks,
}));
vi.mock("../../../../src/hygiene/tasks/audit/datasource-missing", () => ({
  runAuditDatasourceMissing: hygieneMocks.runAuditDatasourceMissing,
}));
vi.mock("../../../../src/hygiene/tasks/audit/dead-templates", () => ({
  runAuditDeadTemplates: hygieneMocks.runAuditDeadTemplates,
}));
vi.mock("../../../../src/hygiene/tasks/audit/duplicates", () => ({
  runAuditDuplicates: hygieneMocks.runAuditDuplicates,
}));
vi.mock("../../../../src/hygiene/tasks/audit/empty-items", () => ({
  runAuditEmptyItems: hygieneMocks.runAuditEmptyItems,
}));
vi.mock("../../../../src/hygiene/tasks/audit/empty-links", () => ({
  runAuditEmptyLinks: hygieneMocks.runAuditEmptyLinks,
}));
vi.mock("../../../../src/hygiene/tasks/audit/empty-roles", () => ({
  runAuditEmptyRoles: hygieneMocks.runAuditEmptyRoles,
}));
vi.mock("../../../../src/hygiene/tasks/audit/fallback-drift", () => ({
  runAuditFallbackDrift: hygieneMocks.runAuditFallbackDrift,
}));
vi.mock("../../../../src/hygiene/tasks/audit/find-replace", () => ({
  runAuditFindReplace: hygieneMocks.runAuditFindReplace,
}));
vi.mock("../../../../src/hygiene/tasks/audit/heavy-templates", () => ({
  runAuditHeavyTemplates: hygieneMocks.runAuditHeavyTemplates,
}));
vi.mock("../../../../src/hygiene/tasks/audit/language-data", () => ({
  runAuditLanguageData: hygieneMocks.runAuditLanguageData,
}));
vi.mock("../../../../src/hygiene/tasks/audit/large-fields", () => ({
  runAuditLargeFields: hygieneMocks.runAuditLargeFields,
}));
vi.mock("../../../../src/hygiene/tasks/audit/missing-meta", () => ({
  runAuditMissingMeta: hygieneMocks.runAuditMissingMeta,
}));
vi.mock("../../../../src/hygiene/tasks/audit/orphans", () => ({
  runAuditOrphans: hygieneMocks.runAuditOrphans,
}));
vi.mock("../../../../src/hygiene/tasks/audit/page-design-orphans", () => ({
  runAuditPageDesignOrphans: hygieneMocks.runAuditPageDesignOrphans,
}));
vi.mock("../../../../src/hygiene/tasks/audit/personalization-broken", () => ({
  runAuditPersonalizationBroken: hygieneMocks.runAuditPersonalizationBroken,
}));
vi.mock("../../../../src/hygiene/tasks/audit/role-bloat", () => ({
  runAuditRoleBloat: hygieneMocks.runAuditRoleBloat,
}));
vi.mock("../../../../src/hygiene/tasks/audit/site-residue", () => ({
  runAuditSiteResidue: hygieneMocks.runAuditSiteResidue,
}));
vi.mock("../../../../src/hygiene/tasks/audit/slug-conflicts", () => ({
  runAuditSlugConflicts: hygieneMocks.runAuditSlugConflicts,
}));
vi.mock("../../../../src/hygiene/tasks/audit/stale-content", () => ({
  runAuditStaleContent: hygieneMocks.runAuditStaleContent,
}));
vi.mock("../../../../src/hygiene/tasks/audit/stale-users", () => ({
  runAuditStaleUsers: hygieneMocks.runAuditStaleUsers,
}));
vi.mock("../../../../src/hygiene/tasks/audit/stale-workflow", () => ({
  runAuditStaleWorkflow: hygieneMocks.runAuditStaleWorkflow,
}));
vi.mock("../../../../src/hygiene/tasks/audit/suite-run", () => ({
  runAuditSuiteRun: hygieneMocks.runAuditSuiteRun,
}));
vi.mock("../../../../src/hygiene/tasks/audit/translation-coverage", () => ({
  runAuditTranslationCoverage: hygieneMocks.runAuditTranslationCoverage,
}));
vi.mock("../../../../src/hygiene/tasks/audit/unused-media", () => ({
  runAuditUnusedMedia: hygieneMocks.runAuditUnusedMedia,
}));
vi.mock("../../../../src/hygiene/tasks/audit/baseline", () => ({
  runBaselineCreate: hygieneMocks.runBaselineCreate,
  runBaselineRemove: hygieneMocks.runBaselineRemove,
  runBaselineReset: hygieneMocks.runBaselineReset,
  runBaselineShow: hygieneMocks.runBaselineShow,
}));
vi.mock("../../../../src/hygiene/tasks/audit/history", () => ({
  runHistoryCapture: hygieneMocks.runHistoryCapture,
  runHistoryList: hygieneMocks.runHistoryList,
}));
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

  it("forwards baseline + output + format + only overrides", async () => {
    hygieneMocks.runAuditSuiteRun.mockClear();
    const reg = await setup();
    const result = await reg.getTool("audit_suite_run")!.handler(
      {
        file: "/tmp/suite.yaml",
        baseline: true,
        output: "/tmp/out.json",
        format: "csv",
        only: ["broken-links"],
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runAuditSuiteRun.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.baseline).toBe(true);
    expect(call.output).toBe("/tmp/out.json");
    expect(call.format).toBe("csv");
    expect(call.only).toEqual(["broken-links"]);
    // `output` set → the structured envelope echoes it.
    expect((result.structuredContent as { output: string | null }).output).toBe("/tmp/out.json");
  });

  it("structuredContent.output is null when no output override is given", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("audit_suite_run")!
      .handler({ file: "/tmp/suite.yaml" }, fakeContext, fakeExtra);
    expect((result.structuredContent as { output: string | null }).output).toBeNull();
  });
});

describe("audit_inspect — verb='run' for audit='all'", () => {
  it("pipes runAuditAll through a tmpfile and surfaces the envelope", async () => {
    const fs = await import("node:fs");
    // runAuditAll writes the envelope to the `output` tmpfile.
    hygieneMocks.runAuditAll.mockImplementationOnce(
      async (opts: { output: string }): Promise<void> => {
        fs.writeFileSync(
          opts.output,
          JSON.stringify({
            counts: { totalFindings: 7 },
            audits: { "broken-links": [], orphans: [] },
          }),
          "utf8"
        );
      }
    );
    const reg = await setup();
    const result = await reg
      .getTool("audit_inspect")!
      .handler({ verb: "run", audit: "all" }, fakeContext, fakeExtra);
    expect(hygieneMocks.runAuditAll).toHaveBeenCalled();
    const structured = result.structuredContent as {
      audit: string;
      envelope: { counts: { totalFindings: number } };
    };
    expect(structured.audit).toBe("all");
    expect(structured.envelope.counts.totalFindings).toBe(7);
    expect(result.content[0]!.text).toContain("7 finding(s)");
  });
});

describe("audit_inspect — forwards cross-cutting filters", () => {
  it("verb='run' forwards limit, includeSystem, exclude, since, owner, baseline", async () => {
    hygieneMocks.runAuditBrokenLinks.mockClear();
    const reg = await setup();
    await reg.getTool("audit_inspect")!.handler(
      {
        verb: "run",
        audit: "broken-links",
        limit: 100,
        includeSystem: true,
        exclude: ["**/Archive/**"],
        since: "2026-01-01T00:00:00Z",
        owner: "alice",
        baseline: true,
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runAuditBrokenLinks.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.limit).toBe(100);
    expect(call.includeSystem).toBe(true);
    expect(call.exclude).toEqual(["**/Archive/**"]);
    expect(call.since).toBe("2026-01-01T00:00:00Z");
    expect(call.owner).toBe("alice");
    expect(call.baseline).toBe(true);
  });

  it("verb='run' merges per-audit auditOptions into the runner bag", async () => {
    hygieneMocks.runAuditMissingMeta.mockClear();
    const reg = await setup();
    await reg.getTool("audit_inspect")!.handler(
      {
        verb: "run",
        audit: "missing-meta",
        auditOptions: { requiredFields: ["title", "description"] },
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runAuditMissingMeta.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.requiredFields).toEqual(["title", "description"]);
  });
});

describe("audit_inspect — history verbs", () => {
  it("verb='history-capture' invokes runHistoryCapture and reports captured", async () => {
    hygieneMocks.runHistoryCapture.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("audit_inspect")!
      .handler(
        { verb: "history-capture", root: "/sitecore/content", limit: 10 },
        fakeContext,
        fakeExtra
      );
    expect(hygieneMocks.runHistoryCapture).toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ verb: "history-capture", captured: true });
  });

  it("verb='history-list' reports the count of snapshots on disk", async () => {
    historyMocks.listHistory.mockReturnValueOnce([
      { filePath: "/tmp/.scai/audit-history/test-env/a.json" } as never,
      { filePath: "/tmp/.scai/audit-history/test-env/b.json" } as never,
    ]);
    const reg = await setup();
    const result = await reg
      .getTool("audit_inspect")!
      .handler({ verb: "history-list" }, fakeContext, fakeExtra);
    const structured = result.structuredContent as { count: number; snapshots: unknown[] };
    expect(structured.count).toBe(2);
    expect(structured.snapshots).toHaveLength(2);
  });

  it("verb='history-diff' throws INPUT_INVALID with fewer than 2 snapshots and no from/to", async () => {
    historyMocks.listHistory.mockReturnValueOnce([]);
    const reg = await setup();
    await expect(
      reg.getTool("audit_inspect")!.handler({ verb: "history-diff" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='history-diff' diffs the two most-recent snapshots by default", async () => {
    historyMocks.listHistory.mockReturnValueOnce([
      { filePath: "/tmp/newest.json" } as never,
      { filePath: "/tmp/older.json" } as never,
    ]);
    historyMocks.loadSnapshot.mockReturnValue({});
    historyMocks.diffSnapshots.mockReturnValueOnce({
      totals: { added: 3, removed: 1, net: 2 },
    } as never);
    const reg = await setup();
    const result = await reg
      .getTool("audit_inspect")!
      .handler({ verb: "history-diff" }, fakeContext, fakeExtra);
    const structured = result.structuredContent as { fromFile: string; toFile: string };
    expect(structured.toFile).toBe("/tmp/newest.json");
    expect(structured.fromFile).toBe("/tmp/older.json");
    expect(result.content[0]!.text).toContain("+3 added");
  });

  it("verb='history-diff' honors explicit from/to even with no snapshots on disk", async () => {
    historyMocks.listHistory.mockReturnValueOnce([]);
    historyMocks.loadSnapshot.mockReturnValue({});
    historyMocks.diffSnapshots.mockReturnValueOnce({
      totals: { added: 0, removed: 0, net: 0 },
    } as never);
    const reg = await setup();
    const result = await reg
      .getTool("audit_inspect")!
      .handler(
        { verb: "history-diff", from: "/tmp/from.json", to: "/tmp/to.json" },
        fakeContext,
        fakeExtra
      );
    const structured = result.structuredContent as { fromFile: string; toFile: string };
    expect(structured.fromFile).toBe("/tmp/from.json");
    expect(structured.toFile).toBe("/tmp/to.json");
  });
});

describe("audit_baseline — update + remove verbs", () => {
  it("verb='update' invokes runBaselineCreate and reports updated", async () => {
    hygieneMocks.runBaselineCreate.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("audit_baseline")!
      .handler(
        { verb: "update", audits: ["broken-links"], resetFirst: true, allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(hygieneMocks.runBaselineCreate).toHaveBeenCalled();
    const call = hygieneMocks.runBaselineCreate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.audits).toEqual(["broken-links"]);
    expect(call.reset).toBe(true);
    expect(result.structuredContent).toMatchObject({ verb: "update", updated: true });
  });

  it("verb='update' promotes a single `audit` into the audits array", async () => {
    hygieneMocks.runBaselineCreate.mockClear();
    const reg = await setup();
    await reg
      .getTool("audit_baseline")!
      .handler({ verb: "update", audit: "orphans", allowWrite: true }, fakeContext, fakeExtra);
    const call = hygieneMocks.runBaselineCreate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.audits).toEqual(["orphans"]);
  });

  it("verb='remove' with audit + fingerprint dispatches runBaselineRemove", async () => {
    hygieneMocks.runBaselineRemove.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("audit_baseline")!
      .handler(
        { verb: "remove", audit: "broken-links", fingerprint: "fp-123", allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(hygieneMocks.runBaselineRemove).toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      verb: "remove",
      audit: "broken-links",
      fingerprint: "fp-123",
      removed: true,
    });
  });

  it("verb='reset' with no audit clears every entry (audit echoed as null)", async () => {
    hygieneMocks.runBaselineReset.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("audit_baseline")!
      .handler({ verb: "reset", allowWrite: true }, fakeContext, fakeExtra);
    expect(hygieneMocks.runBaselineReset).toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ verb: "reset", audit: null, reset: true });
    expect(result.content[0]!.text).toContain("every baseline entry");
  });

  it("verb='show' surfaces totalEntries from the baseline snapshot", async () => {
    baselineMocks.openBaseline.mockReturnValueOnce({
      filePath: "/tmp/.scai/audit-baseline-test-env.json",
      snapshot: () => ({ ignored: { "broken-links": ["fp-1", "fp-2"] } }),
    } as never);
    const reg = await setup();
    const result = await reg
      .getTool("audit_baseline")!
      .handler({ verb: "show" }, fakeContext, fakeExtra);
    expect((result.structuredContent as { totalEntries: number }).totalEntries).toBe(2);
  });
});
