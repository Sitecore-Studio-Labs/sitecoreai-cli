/**
 * Coverage for `runAuditAll` — specifically the contract that
 * sub-audits never see the consolidated report's `--output` flag.
 * Without that scrub, each sub-audit's call to `writeAuditOutput`
 * would overwrite the same file mid-run and only the last audit's
 * findings would survive on disk.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const subAuditMocks = vi.hoisted(() => ({
  runAuditAltTextMissing: vi.fn(async () => []),
  runAuditBrokenImages: vi.fn(async () => []),
  runAuditBrokenLinks: vi.fn(async () => []),
  runAuditEmptyRoles: vi.fn(async () => []),
  runAuditFallbackDrift: vi.fn(async () => []),
  runAuditRoleBloat: vi.fn(async () => []),
  runAuditSlugConflicts: vi.fn(async () => []),
  runAuditStaleUsers: vi.fn(async () => []),
  runAuditTranslationCoverage: vi.fn(async () => []),
  runAuditDatasourceMissing: vi.fn(async () => []),
  runAuditDeadTemplates: vi.fn(async () => []),
  runAuditDuplicates: vi.fn(async () => []),
  runAuditEmptyItems: vi.fn(async () => []),
  runAuditFindReplace: vi.fn(async () => []),
  runAuditHeavyTemplates: vi.fn(async () => []),
  runAuditLanguageData: vi.fn(async () => []),
  runAuditLargeFields: vi.fn(async () => []),
  runAuditMissingMeta: vi.fn(async () => []),
  runAuditOrphans: vi.fn(async () => []),
  runAuditPageDesignOrphans: vi.fn(async () => []),
  runAuditPersonalizationBroken: vi.fn(async () => []),
  runAuditStaleContent: vi.fn(async () => []),
  runAuditStaleWorkflow: vi.fn(async () => []),
  runAuditUnusedMedia: vi.fn(async () => []),
}));

vi.mock("../../../../src/hygiene/tasks/audit/alt-text-missing", () => ({
  runAuditAltTextMissing: subAuditMocks.runAuditAltTextMissing,
}));
vi.mock("../../../../src/hygiene/tasks/audit/broken-images", () => ({
  runAuditBrokenImages: subAuditMocks.runAuditBrokenImages,
}));
vi.mock("../../../../src/hygiene/tasks/audit/broken-links", () => ({
  runAuditBrokenLinks: subAuditMocks.runAuditBrokenLinks,
}));
vi.mock("../../../../src/hygiene/tasks/audit/empty-roles", () => ({
  runAuditEmptyRoles: subAuditMocks.runAuditEmptyRoles,
}));
vi.mock("../../../../src/hygiene/tasks/audit/fallback-drift", () => ({
  runAuditFallbackDrift: subAuditMocks.runAuditFallbackDrift,
}));
vi.mock("../../../../src/hygiene/tasks/audit/role-bloat", () => ({
  runAuditRoleBloat: subAuditMocks.runAuditRoleBloat,
}));
vi.mock("../../../../src/hygiene/tasks/audit/slug-conflicts", () => ({
  runAuditSlugConflicts: subAuditMocks.runAuditSlugConflicts,
}));
vi.mock("../../../../src/hygiene/tasks/audit/stale-users", () => ({
  runAuditStaleUsers: subAuditMocks.runAuditStaleUsers,
}));
vi.mock("../../../../src/hygiene/tasks/audit/translation-coverage", () => ({
  runAuditTranslationCoverage: subAuditMocks.runAuditTranslationCoverage,
}));
vi.mock("../../../../src/hygiene/tasks/audit/datasource-missing", () => ({
  runAuditDatasourceMissing: subAuditMocks.runAuditDatasourceMissing,
}));
vi.mock("../../../../src/hygiene/tasks/audit/dead-templates", () => ({
  runAuditDeadTemplates: subAuditMocks.runAuditDeadTemplates,
}));
vi.mock("../../../../src/hygiene/tasks/audit/duplicates", () => ({
  runAuditDuplicates: subAuditMocks.runAuditDuplicates,
}));
vi.mock("../../../../src/hygiene/tasks/audit/empty-items", () => ({
  runAuditEmptyItems: subAuditMocks.runAuditEmptyItems,
}));
vi.mock("../../../../src/hygiene/tasks/audit/find-replace", () => ({
  runAuditFindReplace: subAuditMocks.runAuditFindReplace,
}));
vi.mock("../../../../src/hygiene/tasks/audit/heavy-templates", () => ({
  runAuditHeavyTemplates: subAuditMocks.runAuditHeavyTemplates,
}));
vi.mock("../../../../src/hygiene/tasks/audit/language-data", () => ({
  runAuditLanguageData: subAuditMocks.runAuditLanguageData,
}));
vi.mock("../../../../src/hygiene/tasks/audit/large-fields", () => ({
  runAuditLargeFields: subAuditMocks.runAuditLargeFields,
}));
vi.mock("../../../../src/hygiene/tasks/audit/missing-meta", () => ({
  runAuditMissingMeta: subAuditMocks.runAuditMissingMeta,
}));
vi.mock("../../../../src/hygiene/tasks/audit/orphans", () => ({
  runAuditOrphans: subAuditMocks.runAuditOrphans,
}));
vi.mock("../../../../src/hygiene/tasks/audit/page-design-orphans", () => ({
  runAuditPageDesignOrphans: subAuditMocks.runAuditPageDesignOrphans,
}));
vi.mock("../../../../src/hygiene/tasks/audit/personalization-broken", () => ({
  runAuditPersonalizationBroken: subAuditMocks.runAuditPersonalizationBroken,
}));
vi.mock("../../../../src/hygiene/tasks/audit/stale-content", () => ({
  runAuditStaleContent: subAuditMocks.runAuditStaleContent,
}));
vi.mock("../../../../src/hygiene/tasks/audit/stale-workflow", () => ({
  runAuditStaleWorkflow: subAuditMocks.runAuditStaleWorkflow,
}));
vi.mock("../../../../src/hygiene/tasks/audit/unused-media", () => ({
  runAuditUnusedMedia: subAuditMocks.runAuditUnusedMedia,
}));

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(() => ({
    envName: "sandbox",
    environment: { name: "sandbox", host: "h" },
    root: { environments: { sandbox: { name: "sandbox" } } },
    timeoutMs: undefined,
  })),
}));

const writeAuditOutputMock = vi.hoisted(() => vi.fn(() => "{}"));
vi.mock("../../../../src/hygiene/output-adapters", () => ({
  writeAuditOutput: writeAuditOutputMock,
}));

const baselineMocks = vi.hoisted(() => ({
  openBaseline: vi.fn(),
  splitByBaseline: vi.fn(),
}));
vi.mock("../../../../src/hygiene/baseline", () => ({
  openBaseline: baselineMocks.openBaseline,
  splitByBaseline: baselineMocks.splitByBaseline,
}));

import { runAuditAll, auditNames } from "../../../../src/hygiene/tasks/audit/all";

afterEach(() => {
  vi.clearAllMocks();
});

describe("runAuditAll", () => {
  it("strips --output and --format from every sub-audit invocation", async () => {
    await runAuditAll({
      include: ["slug-conflicts", "missing-meta"],
      output: "/tmp/should-not-be-overwritten.json",
      format: "json",
      json: true,
      quiet: true,
    } as never);

    expect(subAuditMocks.runAuditSlugConflicts).toHaveBeenCalledTimes(1);
    expect(subAuditMocks.runAuditMissingMeta).toHaveBeenCalledTimes(1);

    for (const mock of [subAuditMocks.runAuditSlugConflicts, subAuditMocks.runAuditMissingMeta]) {
      const subOptions = mock.mock.calls[0][0] as {
        output?: unknown;
        format?: unknown;
        json?: unknown;
        quiet?: unknown;
      };
      expect(subOptions.output).toBeUndefined();
      expect(subOptions.format).toBeUndefined();
      expect(subOptions.json).toBe(true);
      expect(subOptions.quiet).toBe(true);
    }
  });

  it("still writes the consolidated envelope to the parent --output", async () => {
    await runAuditAll({
      include: ["slug-conflicts"],
      output: "/tmp/consolidated.json",
      json: true,
      quiet: true,
    } as never);

    expect(writeAuditOutputMock).toHaveBeenCalledTimes(1);
    const [envelope, opts] = writeAuditOutputMock.mock.calls[0] as [
      { command: string },
      { output: string },
    ];
    expect(envelope.command).toBe("audit.all");
    expect(opts.output).toBe("/tmp/consolidated.json");
  });
});

describe("auditNames", () => {
  it("lists every registered audit name", () => {
    const names = auditNames();
    expect(names).toContain("broken-links");
    expect(names).toContain("find-replace");
    expect(names).toContain("empty-items");
    expect(names.length).toBeGreaterThan(20);
  });
});

describe("runAuditAll — audit selection (pickAuditsToRun)", () => {
  it("runs the default set, skipping requiresExtraConfig audits", async () => {
    await runAuditAll({ json: true, quiet: true } as never);
    // broken-links is a default audit; broken-images / find-replace need extra config.
    expect(subAuditMocks.runAuditBrokenLinks).toHaveBeenCalledTimes(1);
    expect(subAuditMocks.runAuditBrokenImages).not.toHaveBeenCalled();
    expect(subAuditMocks.runAuditFindReplace).not.toHaveBeenCalled();
  });

  it("excludeAudit drops a named audit from the default set", async () => {
    await runAuditAll({ excludeAudit: ["broken-links"], json: true, quiet: true } as never);
    expect(subAuditMocks.runAuditBrokenLinks).not.toHaveBeenCalled();
    expect(subAuditMocks.runAuditSlugConflicts).toHaveBeenCalledTimes(1);
  });

  it("an explicit include list can request a requiresExtraConfig audit", async () => {
    await runAuditAll({ include: ["find-replace"], json: true, quiet: true } as never);
    expect(subAuditMocks.runAuditFindReplace).toHaveBeenCalledTimes(1);
    expect(subAuditMocks.runAuditBrokenLinks).not.toHaveBeenCalled();
  });

  it("matches include names case-insensitively", async () => {
    await runAuditAll({ include: ["SLUG-Conflicts"], json: true, quiet: true } as never);
    expect(subAuditMocks.runAuditSlugConflicts).toHaveBeenCalledTimes(1);
  });
});

describe("runAuditAll — envelope counts + summary", () => {
  it("counts findings across audits and reflects them in the envelope", async () => {
    subAuditMocks.runAuditSlugConflicts.mockResolvedValueOnce([{ a: 1 }, { a: 2 }]);
    subAuditMocks.runAuditMissingMeta.mockResolvedValueOnce([{ b: 1 }]);

    await runAuditAll({
      include: ["slug-conflicts", "missing-meta"],
      output: "/tmp/c.json",
      quiet: true,
    } as never);

    const [envelope] = writeAuditOutputMock.mock.calls[0] as [
      {
        count: number;
        counts: { auditsRun: number; totalFindings: number; auditsFailed: number };
        summary: string;
        data: unknown[];
      },
    ];
    expect(envelope.count).toBe(3);
    expect(envelope.counts.auditsRun).toBe(2);
    expect(envelope.counts.totalFindings).toBe(3);
    expect(envelope.counts.auditsFailed).toBe(0);
    expect(envelope.summary).toBe("2 audits run, 3 findings.");
    expect(envelope.data).toEqual([
      { audit: "slug-conflicts", a: 1 },
      { audit: "slug-conflicts", a: 2 },
      { audit: "missing-meta", b: 1 },
    ]);
  });

  it("records a failed sub-audit's error and counts it as failed", async () => {
    subAuditMocks.runAuditSlugConflicts.mockRejectedValueOnce(new Error("audit blew up"));

    await runAuditAll({
      include: ["slug-conflicts"],
      output: "/tmp/c.json",
      quiet: true,
    } as never);

    const [envelope] = writeAuditOutputMock.mock.calls[0] as [
      {
        counts: { auditsFailed: number };
        summary: string;
        audits: Record<string, { error?: string }>;
      },
    ];
    expect(envelope.counts.auditsFailed).toBe(1);
    expect(envelope.summary).toBe("1 audit run, 0 findings, 1 audit failed.");
    expect(envelope.audits["slug-conflicts"].error).toBe("audit blew up");
  });

  it("coerces a non-array sub-audit return into an empty finding list", async () => {
    subAuditMocks.runAuditSlugConflicts.mockResolvedValueOnce(undefined as never);

    await runAuditAll({
      include: ["slug-conflicts"],
      output: "/tmp/c.json",
      quiet: true,
    } as never);

    const [envelope] = writeAuditOutputMock.mock.calls[0] as [{ count: number }];
    expect(envelope.count).toBe(0);
  });
});

describe("runAuditAll — baseline integration", () => {
  it("splits findings through the baseline file when --baseline is set", async () => {
    subAuditMocks.runAuditSlugConflicts.mockResolvedValueOnce([{ a: 1 }, { a: 2 }]);
    baselineMocks.openBaseline.mockReturnValue({
      filePath: "/tmp/baseline.json",
      add: vi.fn(),
      flush: vi.fn(),
      snapshot: vi.fn(),
    });
    baselineMocks.splitByBaseline.mockReturnValue({ kept: [{ a: 1 }], ignored: [{ a: 2 }] });

    await runAuditAll({
      include: ["slug-conflicts"],
      baseline: true,
      output: "/tmp/c.json",
      quiet: true,
    } as never);

    const [envelope] = writeAuditOutputMock.mock.calls[0] as [
      { count: number; counts: { totalIgnored: number }; baseline: string | null },
    ];
    expect(envelope.count).toBe(1);
    expect(envelope.counts.totalIgnored).toBe(1);
    expect(envelope.baseline).toBe("/tmp/baseline.json");
  });

  it("adds every finding to the baseline and flushes when --update-baseline is set", async () => {
    subAuditMocks.runAuditSlugConflicts.mockResolvedValueOnce([{ a: 1 }, { a: 2 }]);
    const add = vi.fn();
    const flush = vi.fn();
    baselineMocks.openBaseline.mockReturnValue({
      filePath: "/tmp/baseline.json",
      add,
      flush,
      snapshot: vi.fn(),
    });

    await runAuditAll({
      include: ["slug-conflicts"],
      updateBaseline: true,
      output: "/tmp/c.json",
      quiet: true,
    } as never);

    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith("slug-conflicts", { a: 1 }, undefined);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("runAuditAll — output sinks", () => {
  it("echoes the consolidated envelope to logger.json when no --output and not quiet", async () => {
    const jsonSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runAuditAll({ include: ["slug-conflicts"], json: true } as never);
    // No file write, but writeAuditOutput is still called to serialise the body.
    expect(writeAuditOutputMock).toHaveBeenCalledTimes(1);
    jsonSpy.mockRestore();
  });

  it("writes the body to stdout when quiet and no --output", async () => {
    writeAuditOutputMock.mockReturnValueOnce('{"command":"audit.all"}');
    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    await runAuditAll({ include: ["slug-conflicts"], json: true, quiet: true } as never);

    expect(writes.join("")).toContain("audit.all");
    writeSpy.mockRestore();
  });

  it("infers a csv format from a .csv --output extension", async () => {
    await runAuditAll({ include: ["slug-conflicts"], output: "/tmp/r.csv", quiet: true } as never);
    const [, opts] = writeAuditOutputMock.mock.calls[0] as [unknown, { format: string }];
    expect(opts.format).toBe("csv");
  });

  it("infers a markdown format from a .md --output extension", async () => {
    await runAuditAll({ include: ["slug-conflicts"], output: "/tmp/r.md", quiet: true } as never);
    const [, opts] = writeAuditOutputMock.mock.calls[0] as [unknown, { format: string }];
    expect(opts.format).toBe("markdown");
  });

  it("honours an explicit --format over the --output extension", async () => {
    await runAuditAll({
      include: ["slug-conflicts"],
      output: "/tmp/r.csv",
      format: "markdown",
      quiet: true,
    } as never);
    const [, opts] = writeAuditOutputMock.mock.calls[0] as [unknown, { format: string }];
    expect(opts.format).toBe("markdown");
  });
});
