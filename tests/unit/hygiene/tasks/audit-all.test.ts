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

vi.mock("../../../../src/hygiene/tasks/audit-alt-text-missing", () => ({
  runAuditAltTextMissing: subAuditMocks.runAuditAltTextMissing,
}));
vi.mock("../../../../src/hygiene/tasks/audit-broken-images", () => ({
  runAuditBrokenImages: subAuditMocks.runAuditBrokenImages,
}));
vi.mock("../../../../src/hygiene/tasks/audit-broken-links", () => ({
  runAuditBrokenLinks: subAuditMocks.runAuditBrokenLinks,
}));
vi.mock("../../../../src/hygiene/tasks/audit-empty-roles", () => ({
  runAuditEmptyRoles: subAuditMocks.runAuditEmptyRoles,
}));
vi.mock("../../../../src/hygiene/tasks/audit-fallback-drift", () => ({
  runAuditFallbackDrift: subAuditMocks.runAuditFallbackDrift,
}));
vi.mock("../../../../src/hygiene/tasks/audit-role-bloat", () => ({
  runAuditRoleBloat: subAuditMocks.runAuditRoleBloat,
}));
vi.mock("../../../../src/hygiene/tasks/audit-slug-conflicts", () => ({
  runAuditSlugConflicts: subAuditMocks.runAuditSlugConflicts,
}));
vi.mock("../../../../src/hygiene/tasks/audit-stale-users", () => ({
  runAuditStaleUsers: subAuditMocks.runAuditStaleUsers,
}));
vi.mock("../../../../src/hygiene/tasks/audit-translation-coverage", () => ({
  runAuditTranslationCoverage: subAuditMocks.runAuditTranslationCoverage,
}));
vi.mock("../../../../src/hygiene/tasks/audit-datasource-missing", () => ({
  runAuditDatasourceMissing: subAuditMocks.runAuditDatasourceMissing,
}));
vi.mock("../../../../src/hygiene/tasks/audit-dead-templates", () => ({
  runAuditDeadTemplates: subAuditMocks.runAuditDeadTemplates,
}));
vi.mock("../../../../src/hygiene/tasks/audit-duplicates", () => ({
  runAuditDuplicates: subAuditMocks.runAuditDuplicates,
}));
vi.mock("../../../../src/hygiene/tasks/audit-empty-items", () => ({
  runAuditEmptyItems: subAuditMocks.runAuditEmptyItems,
}));
vi.mock("../../../../src/hygiene/tasks/audit-find-replace", () => ({
  runAuditFindReplace: subAuditMocks.runAuditFindReplace,
}));
vi.mock("../../../../src/hygiene/tasks/audit-heavy-templates", () => ({
  runAuditHeavyTemplates: subAuditMocks.runAuditHeavyTemplates,
}));
vi.mock("../../../../src/hygiene/tasks/audit-language-data", () => ({
  runAuditLanguageData: subAuditMocks.runAuditLanguageData,
}));
vi.mock("../../../../src/hygiene/tasks/audit-large-fields", () => ({
  runAuditLargeFields: subAuditMocks.runAuditLargeFields,
}));
vi.mock("../../../../src/hygiene/tasks/audit-missing-meta", () => ({
  runAuditMissingMeta: subAuditMocks.runAuditMissingMeta,
}));
vi.mock("../../../../src/hygiene/tasks/audit-orphans", () => ({
  runAuditOrphans: subAuditMocks.runAuditOrphans,
}));
vi.mock("../../../../src/hygiene/tasks/audit-page-design-orphans", () => ({
  runAuditPageDesignOrphans: subAuditMocks.runAuditPageDesignOrphans,
}));
vi.mock("../../../../src/hygiene/tasks/audit-personalization-broken", () => ({
  runAuditPersonalizationBroken: subAuditMocks.runAuditPersonalizationBroken,
}));
vi.mock("../../../../src/hygiene/tasks/audit-stale-content", () => ({
  runAuditStaleContent: subAuditMocks.runAuditStaleContent,
}));
vi.mock("../../../../src/hygiene/tasks/audit-stale-workflow", () => ({
  runAuditStaleWorkflow: subAuditMocks.runAuditStaleWorkflow,
}));
vi.mock("../../../../src/hygiene/tasks/audit-unused-media", () => ({
  runAuditUnusedMedia: subAuditMocks.runAuditUnusedMedia,
}));

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn(() => ({
    envName: "sandbox",
    environment: { name: "sandbox", host: "h" },
    root: { environments: { sandbox: { name: "sandbox" } } },
    timeoutMs: undefined,
  })),
}));

const writeAuditOutputMock = vi.hoisted(() =>
  vi.fn(() => "{}")
);
vi.mock("../../../../src/hygiene/output-adapters", () => ({
  writeAuditOutput: writeAuditOutputMock,
}));

import { runAuditAll } from "../../../../src/hygiene/tasks/audit-all";

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

    for (const mock of [
      subAuditMocks.runAuditSlugConflicts,
      subAuditMocks.runAuditMissingMeta,
    ]) {
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
