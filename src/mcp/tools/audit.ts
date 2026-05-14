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

import { z } from "zod";
import {
  auditNames,
  runAuditAll,
  runAuditAltTextMissing,
  runAuditBrokenImages,
  runAuditBrokenLinks,
  runAuditDatasourceMissing,
  runAuditDeadTemplates,
  runAuditDuplicates,
  runAuditEmptyItems,
  runAuditEmptyRoles,
  runAuditFallbackDrift,
  runAuditFindReplace,
  runAuditHeavyTemplates,
  runAuditLanguageData,
  runAuditLargeFields,
  runAuditMissingMeta,
  runAuditOrphans,
  runAuditPageDesignOrphans,
  runAuditPersonalizationBroken,
  runAuditRoleBloat,
  runAuditSlugConflicts,
  runAuditStaleContent,
  runAuditStaleUsers,
  runAuditStaleWorkflow,
  runAuditSuiteRun,
  runAuditTranslationCoverage,
  runAuditUnusedMedia,
  runBaselineCreate,
  runBaselineRemove,
  runBaselineReset,
  runBaselineShow,
  runHistoryCapture,
  runHistoryDiff,
  runHistoryList,
} from "@/hygiene/tasks";
import { createScaiError } from "@/shared/errors";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape } from "../schemas/common";

/**
 * Routing table for `audit_inspect` verb=run. The list mirrors
 * `AUDIT_REGISTRY` in `src/hygiene/tasks/audit-all.ts`. We can't import
 * that array directly because each entry there is typed `as never`; we
 * need typed runners to coerce the input options here.
 */
const SINGLE_AUDIT_RUNNERS: Record<
  string,
  (options: Record<string, unknown>) => Promise<unknown[]>
> = {
  "alt-text-missing": runAuditAltTextMissing as never,
  "broken-images": runAuditBrokenImages as never,
  "broken-links": runAuditBrokenLinks as never,
  "datasource-missing": runAuditDatasourceMissing as never,
  "dead-templates": runAuditDeadTemplates as never,
  duplicates: runAuditDuplicates as never,
  "empty-items": runAuditEmptyItems as never,
  "empty-roles": runAuditEmptyRoles as never,
  "fallback-drift": runAuditFallbackDrift as never,
  "find-replace": runAuditFindReplace as never,
  "heavy-templates": runAuditHeavyTemplates as never,
  "language-data": runAuditLanguageData as never,
  "large-fields": runAuditLargeFields as never,
  "missing-meta": runAuditMissingMeta as never,
  orphans: runAuditOrphans as never,
  "page-design-orphans": runAuditPageDesignOrphans as never,
  "personalization-broken": runAuditPersonalizationBroken as never,
  "role-bloat": runAuditRoleBloat as never,
  "slug-conflicts": runAuditSlugConflicts as never,
  "stale-content": runAuditStaleContent as never,
  "stale-users": runAuditStaleUsers as never,
  "stale-workflow": runAuditStaleWorkflow as never,
  "translation-coverage": runAuditTranslationCoverage as never,
  "unused-media": runAuditUnusedMedia as never,
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
        .describe(
          "Content-tree root to scope the audit to. Default `/sitecore/content`."
        ),
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
      owner: z
        .string()
        .optional()
        .describe("Filter to items last-updated by this user."),
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
    },
    handler: async (input, context) => {
      switch (input.verb) {
        case "list": {
          const names = auditNames();
          return {
            content: [
              { type: "text", text: `${names.length} audit(s) registered.` },
            ],
            structuredContent: { verb: input.verb, audits: names },
          };
        }
        case "run": {
          if (!input.audit) {
            throw createScaiError(
              "verb='run' requires `audit`. Use `audit: 'all'` for the consolidated run, or one of the names from verb='list'.",
              "INPUT_INVALID"
            );
          }
          const shared = baseTaskOptions(context.configPath, context.envName, {
            ...(input.root !== undefined && { root: input.root }),
            ...(input.limit !== undefined && { limit: input.limit }),
            ...(input.includeSystem !== undefined && { includeSystem: input.includeSystem }),
            ...(input.exclude !== undefined && { exclude: input.exclude }),
            ...(input.since !== undefined && { since: input.since }),
            ...(input.owner !== undefined && { owner: input.owner }),
            ...(input.baseline !== undefined && { baseline: input.baseline }),
            ...(input.auditOptions ?? {}),
          });
          if (input.audit === "all") {
            // runAuditAll prints + writes; it doesn't return the
            // envelope. Pipe through a tmpfile so the MCP client gets
            // structured output (matches the pattern in audit-history).
            const fs = await import("node:fs");
            const os = await import("node:os");
            const path = await import("node:path");
            const tmpFile = path.join(
              os.tmpdir(),
              `scai-audit-all-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
            );
            await runAuditAll({
              ...shared,
              output: tmpFile,
              format: "json",
            } as never);
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
            const count = (envelope.counts as { totalFindings?: number } | undefined)
              ?.totalFindings;
            return {
              content: [
                {
                  type: "text",
                  text: `audit all: ${count ?? "?"} finding(s) across ${Object.keys(envelope.audits ?? {}).length} audit(s).`,
                },
              ],
              structuredContent: { verb: input.verb, audit: "all", envelope },
            };
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
            content: [
              {
                type: "text",
                text: `audit ${input.audit}: ${findings.length} finding(s).`,
              },
            ],
            structuredContent: {
              verb: input.verb,
              audit: input.audit,
              count: findings.length,
              findings,
            },
          };
        }
        case "history-capture": {
          await runHistoryCapture(
            baseTaskOptions(context.configPath, context.envName, {
              ...(input.root !== undefined && { root: input.root }),
              ...(input.limit !== undefined && { limit: input.limit }),
              ...(input.includeSystem !== undefined && { includeSystem: input.includeSystem }),
              ...(input.exclude !== undefined && { exclude: input.exclude }),
              ...(input.since !== undefined && { since: input.since }),
            }) as never
          );
          return {
            content: [
              {
                type: "text",
                text: "Captured audit history snapshot.",
              },
            ],
            structuredContent: { verb: input.verb, captured: true },
          };
        }
        case "history-list": {
          // runHistoryList prints; reconstruct by reading directly.
          // Re-use the same module so we don't duplicate the path layout.
          const { listHistory } = await import("@/hygiene/history");
          const path = await import("node:path");
          const configDir = context.configPath?.endsWith(".json")
            ? path.dirname(context.configPath)
            : (context.configPath ?? process.cwd());
          const snapshots = listHistory({ envName: context.envName, configDir });
          // Invoke the task runner too, so the logger trail mirrors the CLI
          // (no-op when quiet=true; included for parity with other tools).
          await runHistoryList(
            baseTaskOptions(context.configPath, context.envName) as never
          );
          return {
            content: [
              {
                type: "text",
                text: `${snapshots.length} snapshot(s) on disk.`,
              },
            ],
            structuredContent: {
              verb: input.verb,
              count: snapshots.length,
              snapshots,
            },
          };
        }
        case "history-diff": {
          // runHistoryDiff prints; we need the structured diff too.
          // Re-implement against the same primitives.
          const { listHistory, loadSnapshot, diffSnapshots } = await import(
            "@/hygiene/history"
          );
          const path = await import("node:path");
          const configDir = context.configPath?.endsWith(".json")
            ? path.dirname(context.configPath)
            : (context.configPath ?? process.cwd());
          const snapshots = listHistory({ envName: context.envName, configDir });
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
            structuredContent: {
              verb: input.verb,
              fromFile: fromPath,
              toFile: toPath,
              ...diff,
            },
          };
        }
      }
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
      root: z
        .string()
        .optional()
        .describe("Forwarded to the audit run when `verb='update'`."),
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
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const shared = baseTaskOptions(context.configPath, context.envName);
      switch (input.verb) {
        case "show": {
          // runBaselineShow prints; re-derive the structure for the
          // structuredContent envelope.
          const { openBaseline } = await import("@/hygiene/baseline");
          const path = await import("node:path");
          const configDir = context.configPath?.endsWith(".json")
            ? path.dirname(context.configPath)
            : (context.configPath ?? process.cwd());
          const baseline = openBaseline({
            envName: context.envName,
            configDir,
            logger: undefined as never,
          });
          const snapshot = baseline.snapshot();
          const totalEntries = Object.values(snapshot.ignored).reduce(
            (n, list) => n + list.length,
            0
          );
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
        }
        case "update": {
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
        }
        case "remove": {
          if (!input.audit || !input.fingerprint) {
            throw createScaiError(
              "verb='remove' requires `audit` and `fingerprint`.",
              "INPUT_INVALID"
            );
          }
          await runBaselineRemove({
            ...shared,
            audit: input.audit,
            fingerprint: input.fingerprint,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `Removed ${input.audit}/${input.fingerprint} from baseline.`,
              },
            ],
            structuredContent: {
              verb: input.verb,
              audit: input.audit,
              fingerprint: input.fingerprint,
              removed: true,
            },
          };
        }
        case "reset": {
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
            structuredContent: {
              verb: input.verb,
              audit: input.audit ?? null,
              reset: true,
            },
          };
        }
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
      baseline: z
        .boolean()
        .optional()
        .describe("Override the suite's `baseline.enabled` setting."),
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
    },
    handler: async (input, context) => {
      await runAuditSuiteRun({
        ...baseTaskOptions(context.configPath, context.envName),
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
