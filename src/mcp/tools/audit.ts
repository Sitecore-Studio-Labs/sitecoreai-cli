/**
 * Audit domain — inspect, baseline, suite.
 *
 * Three read-side tools cover the full hygiene-reporting surface:
 *
 *   - `audit_inspect` — discriminated `{ verb }` entry that lists
 *     available audits, runs one (or `all`) in-process, captures a
 *     history snapshot, lists captured snapshots, or diffs two
 *     snapshots. The single tool replaces five CLI verbs so agents
 *     don't need to memorize a half-dozen names; the verb discriminator
 *     keeps each call's inputs scoped.
 *
 *   - `audit_baseline` — discriminated `{ verb }` entry for the per-env
 *     baseline file at `.scai/audit-baseline-<envName>.json`. Show is
 *     free; `update`, `remove`, and `reset` mutate the local baseline
 *     file (not the tenant), and are write-gated so the host's
 *     confirmation UX kicks in before any baseline change.
 *
 *   - `audit_suite_run` — load + execute a YAML suite file. Read-side
 *     by definition (suites themselves can't mutate the tenant), but
 *     can resolve `baseline=true` if the suite says so.
 *
 * Every audit run delegates to the CLI-shared `runAudit*` task; this
 * MCP layer only forwards routing + the structured-content envelope.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { auditNames, runAuditAll } from "@/hygiene/tasks/audit/all";
import { runAuditAltTextMissing } from "@/hygiene/tasks/audit/alt-text-missing";
import { runAuditBrokenImages } from "@/hygiene/tasks/audit/broken-images";
import { runAuditBrokenLinks } from "@/hygiene/tasks/audit/broken-links";
import { runAuditDatasourceMissing } from "@/hygiene/tasks/audit/datasource-missing";
import { runAuditDeadTemplates } from "@/hygiene/tasks/audit/dead-templates";
import { runAuditDuplicates } from "@/hygiene/tasks/audit/duplicates";
import { runAuditEmptyItems } from "@/hygiene/tasks/audit/empty-items";
import { runAuditEmptyLinks } from "@/hygiene/tasks/audit/empty-links";
import { runAuditEmptyRoles } from "@/hygiene/tasks/audit/empty-roles";
import { runAuditFallbackDrift } from "@/hygiene/tasks/audit/fallback-drift";
import { runAuditFindReplace } from "@/hygiene/tasks/audit/find-replace";
import { runAuditHeavyTemplates } from "@/hygiene/tasks/audit/heavy-templates";
import { runAuditLanguageData } from "@/hygiene/tasks/audit/language-data";
import { runAuditLargeFields } from "@/hygiene/tasks/audit/large-fields";
import { runAuditMissingMeta } from "@/hygiene/tasks/audit/missing-meta";
import { runAuditOrphans } from "@/hygiene/tasks/audit/orphans";
import { runAuditPageDesignOrphans } from "@/hygiene/tasks/audit/page-design-orphans";
import { runAuditPersonalizationBroken } from "@/hygiene/tasks/audit/personalization-broken";
import { runAuditReferences } from "@/hygiene/tasks/audit/references";
import { runAuditRoleBloat } from "@/hygiene/tasks/audit/role-bloat";
import { runAuditSiteResidue } from "@/hygiene/tasks/audit/site-residue";
import { runAuditSlugConflicts } from "@/hygiene/tasks/audit/slug-conflicts";
import { runAuditStaleContent } from "@/hygiene/tasks/audit/stale-content";
import { runAuditStaleUsers } from "@/hygiene/tasks/audit/stale-users";
import { runAuditStaleWorkflow } from "@/hygiene/tasks/audit/stale-workflow";
import { runAuditTemplateDependencies } from "@/hygiene/tasks/audit/template-dependencies";
import { runAuditSuiteRun } from "@/hygiene/tasks/audit/suite-run";
import { runAuditTranslationCoverage } from "@/hygiene/tasks/audit/translation-coverage";
import { runAuditUnusedMedia } from "@/hygiene/tasks/audit/unused-media";
import {
  runBaselineCreate,
  runBaselineRemove,
  runBaselineReset,
  runBaselineShow,
} from "@/hygiene/tasks/audit/baseline";
import { runHistoryCapture, runHistoryList } from "@/hygiene/tasks/audit/history";
import { createScaiError } from "@/shared/errors";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape } from "../schemas/common";

/**
 * Loose-typed runner shape — the dispatch path hands every runner a
 * `Record<string, unknown>` option bag because the MCP boundary doesn't
 * know the per-audit option type at compile time.
 */
type LoosedRunner = (options: Record<string, unknown>) => Promise<readonly unknown[]>;

/**
 * Convert a typed runner into a loose-typed one for the dispatch table.
 * The inner cast is the same unsafe move that `as never` used to make,
 * but it's localized to one helper *and* it requires the caller to
 * supply a function whose return type is `Promise<readonly X[]>` — so
 * if a runner ever stops returning a flat array (the way
 * `runCleanupDeadTemplates` does — see cleanup.ts for the workaround),
 * the call to `loosen` fails type-check and the bug surfaces here
 * instead of in production.
 */
const loosen = <O>(fn: (options: O) => Promise<readonly unknown[]>): LoosedRunner =>
  fn as unknown as LoosedRunner;

/**
 * Routing table for `audit_inspect` verb=run. The list mirrors
 * `AUDIT_REGISTRY` in `src/hygiene/tasks/audit/all.ts` — the
 * `cli-mcp-parity.test.ts` routing-table test asserts the two stay in
 * lockstep, so it is exported for that test.
 */
export const SINGLE_AUDIT_RUNNERS: Record<string, LoosedRunner> = {
  "alt-text-missing": loosen(runAuditAltTextMissing),
  "broken-images": loosen(runAuditBrokenImages),
  "broken-links": loosen(runAuditBrokenLinks),
  "datasource-missing": loosen(runAuditDatasourceMissing),
  "dead-templates": loosen(runAuditDeadTemplates),
  duplicates: loosen(runAuditDuplicates),
  "empty-items": loosen(runAuditEmptyItems),
  "empty-links": loosen(runAuditEmptyLinks),
  "empty-roles": loosen(runAuditEmptyRoles),
  "fallback-drift": loosen(runAuditFallbackDrift),
  "find-replace": loosen(runAuditFindReplace),
  "heavy-templates": loosen(runAuditHeavyTemplates),
  "language-data": loosen(runAuditLanguageData),
  "large-fields": loosen(runAuditLargeFields),
  "missing-meta": loosen(runAuditMissingMeta),
  orphans: loosen(runAuditOrphans),
  "page-design-orphans": loosen(runAuditPageDesignOrphans),
  "personalization-broken": loosen(runAuditPersonalizationBroken),
  references: loosen(runAuditReferences),
  "role-bloat": loosen(runAuditRoleBloat),
  "site-residue": loosen(runAuditSiteResidue),
  "slug-conflicts": loosen(runAuditSlugConflicts),
  "stale-content": loosen(runAuditStaleContent),
  "stale-users": loosen(runAuditStaleUsers),
  "stale-workflow": loosen(runAuditStaleWorkflow),
  "template-dependencies": loosen(runAuditTemplateDependencies),
  "translation-coverage": loosen(runAuditTranslationCoverage),
  "unused-media": loosen(runAuditUnusedMedia),
};

const baseTaskOptions = (
  config: string,
  envName: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  config,
  environmentName: envName,
  quiet: true,
  json: true,
  ...overrides,
});

/**
 * Per-verb handlers for `audit_inspect`. Each verb's input-marshalling
 * and result-shaping is its own small function so the tool `handler`
 * collapses to: look up the verb runner, call it. The `input` arg is
 * the validated tool input; `envName`/`configPath` are pre-resolved so
 * each verb runner sees the same context-derived values.
 */
type AuditInspectInput = {
  verb: string;
  audit?: string;
  root?: string;
  limit?: number;
  includeSystem?: boolean;
  exclude?: string[];
  since?: string;
  owner?: string;
  baseline?: boolean;
  from?: string;
  to?: string;
  auditOptions?: Record<string, unknown>;
};

const auditInspectList = (input: AuditInspectInput): CallToolResult => {
  const names = auditNames();
  return {
    content: [{ type: "text", text: `${names.length} audit(s) registered.` }],
    structuredContent: { verb: input.verb, audits: names },
  };
};

/** Build the shared option bag honored by every single-audit runner. */
const buildAuditRunShared = (
  input: AuditInspectInput,
  configPath: string,
  envName: string
): Record<string, unknown> => {
  // `site-residue` is the lone audit whose `root` is `string[]` (extra
  // SXA Project roots) instead of a content-tree string. Forwarding the
  // top-level `root` (string) here would corrupt the array spread.
  // Callers extend the SXA defaults via `auditOptions: { root: [...] }`.
  const forwardRoot = input.audit !== "site-residue";
  return baseTaskOptions(configPath, envName, {
    ...(forwardRoot && input.root !== undefined && { root: input.root }),
    ...(input.limit !== undefined && { limit: input.limit }),
    ...(input.includeSystem !== undefined && { includeSystem: input.includeSystem }),
    ...(input.exclude !== undefined && { exclude: input.exclude }),
    ...(input.since !== undefined && { since: input.since }),
    ...(input.owner !== undefined && { owner: input.owner }),
    ...(input.baseline !== undefined && { baseline: input.baseline }),
    ...(input.auditOptions ?? {}),
  });
};

/** verb='run' with audit='all' — pipe runAuditAll through a tmpfile. */
const auditInspectRunAll = async (
  input: AuditInspectInput,
  shared: Record<string, unknown>
): Promise<CallToolResult> => {
  // runAuditAll prints + writes; it doesn't return the envelope. Pipe
  // through a tmpfile so the MCP client gets structured output (matches
  // the pattern in audit-history).
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmpFile = path.join(
    os.tmpdir(),
    `scai-audit-all-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );
  await runAuditAll({ ...shared, output: tmpFile, format: "json" } as never);
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
  const count = (envelope.counts as { totalFindings?: number } | undefined)?.totalFindings;
  return {
    content: [
      {
        type: "text",
        text: `audit all: ${count ?? "?"} finding(s) across ${Object.keys(envelope.audits ?? {}).length} audit(s).`,
      },
    ],
    structuredContent: { verb: input.verb, audit: "all", envelope },
  };
};

const auditInspectRun = async (
  input: AuditInspectInput,
  configPath: string,
  envName: string
): Promise<CallToolResult> => {
  if (!input.audit) {
    throw createScaiError(
      "verb='run' requires `audit`. Use `audit: 'all'` for the consolidated run, or one of the names from verb='list'.",
      "INPUT_INVALID"
    );
  }
  const shared = buildAuditRunShared(input, configPath, envName);
  if (input.audit === "all") {
    return auditInspectRunAll(input, shared);
  }
  const runner = SINGLE_AUDIT_RUNNERS[input.audit];
  if (!runner) {
    throw createScaiError(
      `Unknown audit '${input.audit}'. Run verb='list' to see registered audits.`,
      "INPUT_INVALID"
    );
  }
  const findings = await runner(shared);
  return {
    content: [{ type: "text", text: `audit ${input.audit}: ${findings.length} finding(s).` }],
    structuredContent: {
      verb: input.verb,
      audit: input.audit,
      count: findings.length,
      findings,
    },
  };
};

const auditInspectHistoryCapture = async (
  input: AuditInspectInput,
  configPath: string,
  envName: string
): Promise<CallToolResult> => {
  await runHistoryCapture(
    baseTaskOptions(configPath, envName, {
      ...(input.root !== undefined && { root: input.root }),
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.includeSystem !== undefined && { includeSystem: input.includeSystem }),
      ...(input.exclude !== undefined && { exclude: input.exclude }),
      ...(input.since !== undefined && { since: input.since }),
    }) as never
  );
  return {
    content: [{ type: "text", text: "Captured audit history snapshot." }],
    structuredContent: { verb: input.verb, captured: true },
  };
};

/** Resolve the config directory the history primitives read snapshots from. */
const historyConfigDir = async (configPath: string | undefined): Promise<string> => {
  const path = await import("node:path");
  return configPath?.endsWith(".json") ? path.dirname(configPath) : (configPath ?? process.cwd());
};

const auditInspectHistoryList = async (
  input: AuditInspectInput,
  configPath: string,
  envName: string
): Promise<CallToolResult> => {
  // runHistoryList prints; reconstruct by reading directly. Re-use the
  // same module so we don't duplicate the path layout.
  const { listHistory } = await import("@/hygiene/history");
  const configDir = await historyConfigDir(configPath);
  const snapshots = listHistory({ envName, configDir });
  // Invoke the task runner too, so the logger trail mirrors the CLI
  // (no-op when quiet=true; included for parity with other tools).
  await runHistoryList(baseTaskOptions(configPath, envName) as never);
  return {
    content: [{ type: "text", text: `${snapshots.length} snapshot(s) on disk.` }],
    structuredContent: { verb: input.verb, count: snapshots.length, snapshots },
  };
};

const auditInspectHistoryDiff = async (
  input: AuditInspectInput,
  configPath: string,
  envName: string
): Promise<CallToolResult> => {
  // runHistoryDiff prints; we need the structured diff too. Re-implement
  // against the same primitives.
  const { listHistory, loadSnapshot, diffSnapshots } = await import("@/hygiene/history");
  const configDir = await historyConfigDir(configPath);
  const snapshots = listHistory({ envName, configDir });
  if (snapshots.length < 2 && (!input.from || !input.to)) {
    throw createScaiError(
      `Need at least 2 snapshots to diff (have ${snapshots.length}).`,
      "INPUT_INVALID"
    );
  }
  const toPath = input.to ?? snapshots[0].filePath;
  const fromPath = input.from ?? snapshots[1].filePath;
  const diff = diffSnapshots(loadSnapshot(fromPath), loadSnapshot(toPath));
  return {
    content: [
      {
        type: "text",
        text: `Diff: +${diff.totals.added} added, -${diff.totals.removed} removed (net ${diff.totals.net >= 0 ? "+" : ""}${diff.totals.net}).`,
      },
    ],
    structuredContent: { verb: input.verb, fromFile: fromPath, toFile: toPath, ...diff },
  };
};

/**
 * verb → handler dispatch table for `audit_inspect`. Each entry takes
 * the validated input plus the resolved config path + env name. Keeps
 * the tool `handler` itself a one-line lookup + call (no switch).
 */
const AUDIT_INSPECT_RUNNERS: Record<
  string,
  (
    input: AuditInspectInput,
    configPath: string,
    envName: string
  ) => Promise<CallToolResult> | CallToolResult
> = {
  list: (input) => auditInspectList(input),
  run: auditInspectRun,
  "history-capture": auditInspectHistoryCapture,
  "history-list": auditInspectHistoryList,
  "history-diff": auditInspectHistoryDiff,
};

/**
 * Per-verb handlers for `audit_baseline`. Same shape as the inspect
 * runners: validated input + resolved config/env, returning the tool
 * result. Keeps the tool `handler` a one-line table lookup.
 */
type AuditBaselineInput = {
  verb: string;
  audit?: string;
  audits?: string[];
  fingerprint?: string;
  resetFirst?: boolean;
  root?: string;
  limit?: number;
  includeSystem?: boolean;
};

const auditBaselineShow = async (
  input: AuditBaselineInput,
  configPath: string,
  envName: string,
  shared: Record<string, unknown>
): Promise<CallToolResult> => {
  // runBaselineShow prints; re-derive the structure for the
  // structuredContent envelope.
  const { openBaseline } = await import("@/hygiene/baseline");
  const configDir = await historyConfigDir(configPath);
  const baseline = openBaseline({ envName, configDir, logger: undefined as never });
  const snapshot = baseline.snapshot();
  const totalEntries = Object.values(snapshot.ignored).reduce((n, list) => n + list.length, 0);
  await runBaselineShow(shared as never);
  return {
    content: [
      {
        type: "text",
        text: `Baseline ${baseline.filePath}: ${totalEntries} entr${totalEntries === 1 ? "y" : "ies"}.`,
      },
    ],
    structuredContent: {
      verb: input.verb,
      filePath: baseline.filePath,
      totalEntries,
      ignored: snapshot.ignored,
    },
  };
};

const auditBaselineUpdate = async (
  input: AuditBaselineInput,
  shared: Record<string, unknown>
): Promise<CallToolResult> => {
  await runBaselineCreate({
    ...shared,
    ...(input.audits !== undefined && { audits: input.audits }),
    ...(input.audit !== undefined && !input.audits && { audits: [input.audit] }),
    ...(input.resetFirst !== undefined && { reset: input.resetFirst }),
    ...(input.root !== undefined && { root: input.root }),
    ...(input.limit !== undefined && { limit: input.limit }),
    ...(input.includeSystem !== undefined && { includeSystem: input.includeSystem }),
  } as never);
  return {
    content: [{ type: "text", text: "Baseline updated." }],
    structuredContent: { verb: input.verb, updated: true },
  };
};

const auditBaselineRemove = async (
  input: AuditBaselineInput,
  shared: Record<string, unknown>
): Promise<CallToolResult> => {
  if (!input.audit || !input.fingerprint) {
    throw createScaiError("verb='remove' requires `audit` and `fingerprint`.", "INPUT_INVALID");
  }
  await runBaselineRemove({
    ...shared,
    audit: input.audit,
    fingerprint: input.fingerprint,
  } as never);
  return {
    content: [{ type: "text", text: `Removed ${input.audit}/${input.fingerprint} from baseline.` }],
    structuredContent: {
      verb: input.verb,
      audit: input.audit,
      fingerprint: input.fingerprint,
      removed: true,
    },
  };
};

const auditBaselineReset = async (
  input: AuditBaselineInput,
  shared: Record<string, unknown>
): Promise<CallToolResult> => {
  await runBaselineReset({
    ...shared,
    ...(input.audit !== undefined && { audit: input.audit }),
  } as never);
  return {
    content: [
      {
        type: "text",
        text: input.audit
          ? `Reset baseline entries for ${input.audit}.`
          : "Reset every baseline entry.",
      },
    ],
    structuredContent: { verb: input.verb, audit: input.audit ?? null, reset: true },
  };
};

export const registerAuditTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "audit_inspect",
    description: TOOL_DESCRIPTIONS.audit_inspect,
    auth: "read",
    annotations: {
      title: "Inspect, run, and diff content hygiene audits",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["list", "run", "history-capture", "history-list", "history-diff"])
        .describe(
          "Which read-side audit operation to run. `list` returns the registry of available audit names. `run` executes one audit (`audit: 'broken-links'`) or every audit (`audit: 'all'`). `history-capture` runs `all` and persists the result to `.scai/audit-history/<env>/<datetime>.json`. `history-list` returns the snapshots already on disk. `history-diff` compares two snapshots by fingerprint and returns per-audit added/removed counts."
        ),
      audit: z
        .string()
        .optional()
        .describe(
          "Audit name for `run` — one of the names returned by `verb='list'`, or the literal 'all' for the consolidated run. Ignored for other verbs."
        ),
      // Cross-cutting filters honored by every audit runner.
      root: z
        .string()
        .optional()
        .describe("Content-tree root to scope the audit to. Default `/sitecore/content`."),
      limit: z
        .number()
        .int()
        .positive()
        .max(50_000)
        .optional()
        .describe("Maximum number of items to scan for a single audit. Default per-audit."),
      includeSystem: z
        .boolean()
        .optional()
        .describe(
          "Include items under /sitecore/system and /sitecore/templates. Off by default — most audits restrict to content."
        ),
      exclude: z
        .array(z.string())
        .optional()
        .describe("Glob patterns of paths to exclude from the scan."),
      since: z
        .string()
        .optional()
        .describe("ISO-8601 datetime — restrict to items updated since this instant."),
      owner: z.string().optional().describe("Filter to items last-updated by this user."),
      baseline: z
        .boolean()
        .optional()
        .describe(
          "When true, filter findings through the per-env baseline file. Findings whose fingerprint appears in the baseline are returned in `ignored` rather than `findings`."
        ),
      // history-diff inputs
      from: z
        .string()
        .optional()
        .describe(
          "Snapshot file path to diff FROM (verb='history-diff'). Defaults to the second-most-recent snapshot."
        ),
      to: z
        .string()
        .optional()
        .describe(
          "Snapshot file path to diff TO (verb='history-diff'). Defaults to the most recent snapshot."
        ),
      // Per-audit options that show up often enough to surface here. The
      // long tail (per-audit specifics like `targetLanguages`, `pattern`,
      // `requiredFields`) is passed through `auditOptions` so we don't
      // explode the top-level schema with every leaf flag.
      auditOptions: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Per-audit option bag. Forwarded verbatim to the runner. Use this for audit-specific flags — e.g. `{ requiredFields: ['title','description'] }` for missing-meta, `{ pattern: 'foo' }` for find-replace, or `{ targetLanguages: ['en','fr'] }` for translation-coverage. Stays opt-in so common runs don't need it."
        ),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      const runner = AUDIT_INSPECT_RUNNERS[input.verb];
      return runner(input as AuditInspectInput, context.configPath, envName);
    },
  });

  registry.registerTool({
    name: "audit_baseline",
    description: TOOL_DESCRIPTIONS.audit_baseline,
    auth: "write",
    annotations: {
      title: "Manage the per-env audit baseline file",
      readOnlyHint: false,
      // The baseline file is local, not tenant state. Still mark
      // destructive so hosts surface confirmation before a reset / remove
      // wipes an accepted-findings set the operator may want to keep.
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      verb: z
        .enum(["show", "update", "remove", "reset"])
        .describe(
          "Baseline operation. `show` is read-only and returns the per-audit fingerprint listing. `update` runs the selected audits and folds every current finding into the baseline (use after an operator review accepts the current state). `remove` deletes a single fingerprint from a named audit. `reset` clears every entry for one named audit (or every audit, if `audit` is omitted)."
        ),
      audit: z
        .string()
        .optional()
        .describe(
          "Audit name. Required for `remove`. Optional for `reset` (defaults to all audits) and `update` (defaults to running every audit)."
        ),
      audits: z
        .array(z.string())
        .optional()
        .describe(
          "For `update`: list of audit names to run when refreshing the baseline. Defaults to every audit."
        ),
      fingerprint: z
        .string()
        .optional()
        .describe(
          "For `remove`: the finding fingerprint to drop. Get this from `audit_baseline` verb='show'."
        ),
      resetFirst: z
        .boolean()
        .optional()
        .describe(
          "For `update`: drop existing entries for the target audits before re-running, instead of merging. Default false (merge)."
        ),
      root: z.string().optional().describe("Forwarded to the audit run when `verb='update'`."),
      limit: z
        .number()
        .int()
        .positive()
        .max(50_000)
        .optional()
        .describe("Forwarded to the audit run when `verb='update'`."),
      includeSystem: z
        .boolean()
        .optional()
        .describe("Forwarded to the audit run when `verb='update'`."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      const shared = baseTaskOptions(context.configPath, envName);
      const args = input as AuditBaselineInput;
      switch (args.verb) {
        case "show":
          return auditBaselineShow(args, context.configPath, envName, shared);
        case "update":
          return auditBaselineUpdate(args, shared);
        case "remove":
          return auditBaselineRemove(args, shared);
        default:
          return auditBaselineReset(args, shared);
      }
    },
  });

  registry.registerTool({
    name: "audit_suite_run",
    description: TOOL_DESCRIPTIONS.audit_suite_run,
    auth: "read",
    annotations: {
      title: "Run a YAML-defined audit suite",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      file: z
        .string()
        .describe(
          "Path to the suite YAML file. Resolved relative to the MCP server's working directory."
        ),
      baseline: z.boolean().optional().describe("Override the suite's `baseline.enabled` setting."),
      output: z
        .string()
        .optional()
        .describe(
          "Override the suite's `output.path`. Supports {date}, {datetime}, {env}, {suite} tokens."
        ),
      format: z
        .enum(["json", "csv", "markdown"])
        .optional()
        .describe("Override the suite's `output.format`."),
      only: z
        .array(z.string())
        .optional()
        .describe(
          "Run only this subset of the suite's audits. Useful for re-running after a targeted fix."
        ),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      await runAuditSuiteRun({
        ...baseTaskOptions(context.configPath, input.environmentName ?? context.envName),
        file: input.file,
        ...(input.baseline !== undefined && { baseline: input.baseline }),
        ...(input.output !== undefined && { output: input.output }),
        ...(input.format !== undefined && { format: input.format }),
        ...(input.only !== undefined && { only: input.only }),
      } as never);
      return {
        content: [
          {
            type: "text",
            text: `Suite '${input.file}' executed${input.output ? ` → ${input.output}` : ""}.`,
          },
        ],
        structuredContent: {
          verb: "run",
          file: input.file,
          executed: true,
          output: input.output ?? null,
        },
      };
    },
  });
};
