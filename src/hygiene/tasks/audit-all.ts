import { openBaseline, splitByBaseline } from "../baseline";
import { writeAuditOutput, type OutputFormat } from "../output-adapters";
import { type HygieneCommonOptions, toLogger } from "./shared";
import { runAuditAltTextMissing } from "./audit-alt-text-missing";
import { runAuditBrokenLinks } from "./audit-broken-links";
import { runAuditDatasourceMissing } from "./audit-datasource-missing";
import { runAuditDeadTemplates } from "./audit-dead-templates";
import { runAuditDuplicates } from "./audit-duplicates";
import { runAuditEmptyItems } from "./audit-empty-items";
import { runAuditFindReplace } from "./audit-find-replace";
import { runAuditHeavyTemplates } from "./audit-heavy-templates";
import { runAuditLanguageData } from "./audit-language-data";
import { runAuditLargeFields } from "./audit-large-fields";
import { runAuditMissingMeta } from "./audit-missing-meta";
import { runAuditOrphans } from "./audit-orphans";
import { runAuditPageDesignOrphans } from "./audit-page-design-orphans";
import { runAuditPersonalizationBroken } from "./audit-personalization-broken";
import { runAuditStaleContent } from "./audit-stale-content";
import { runAuditStaleWorkflow } from "./audit-stale-workflow";
import { runAuditUnusedMedia } from "./audit-unused-media";

/**
 * Meta-command: run every (or a chosen subset) audit and emit a
 * consolidated report.
 *
 * Use cases:
 *   - One-shot tenant health check for stakeholders.
 *   - CI step: "fail if any audit finds new issues (vs. baseline)".
 *   - Scheduled audit runs that pipe to Slack via `--output` + a
 *     webhook in the CI script.
 *
 * Filter model:
 *   - `--include broken-links,unused-media` runs only those audits.
 *   - `--exclude-audit find-replace` runs everything except that
 *     audit (rename to avoid clashing with the cross-cutting
 *     `--exclude <path>` filter).
 *   - Sensible defaults: `find-replace` is OFF by default in `audit
 *     all` because it requires a `--pattern` flag.
 *
 * Baseline integration:
 *   - `--baseline` causes each audit's findings to be filtered
 *     through the per-env baseline file. The report distinguishes
 *     `findings` (new) from `ignored` (baseline-matched).
 *   - `--update-baseline` accepts every current finding as the new
 *     baseline (use after a manual review).
 */

export interface AuditAllOptions extends HygieneCommonOptions {
  /** Comma-separated list of audit names to run. Default: all except find-replace. */
  include?: string[];
  /** Comma-separated list of audit names to skip. */
  excludeAudit?: string[];
  /** Apply the per-env baseline file to filter known findings. */
  baseline?: boolean;
  /**
   * After running, replace the baseline file with the current finding
   * set. Useful for snapshotting an accepted state. Off by default.
   */
  updateBaseline?: boolean;
  /** Path to write the output to. Default: stdout. */
  output?: string;
  /** Output format. Defaults to `json` (also inferred from --output extension). */
  format?: OutputFormat;
  /** Common per-audit defaults (passed to every sub-audit). */
  root?: string;
  limit?: number;
  includeSystem?: boolean;
  index?: string;
  concurrency?: number;
  batchSize?: number;
  pageParallelism?: number;
  cache?: boolean;
  exclude?: string[];
  since?: string;
  owner?: string;
}

/** Definition of a sub-audit invocation. */
interface AuditDef {
  name: string;
  run: (options: Record<string, unknown>) => Promise<unknown[]>;
  /** Audits that need extra config we don't have in `audit all` shape. */
  requiresExtraConfig?: boolean;
}

const AUDIT_REGISTRY: AuditDef[] = [
  { name: "alt-text-missing", run: runAuditAltTextMissing as never },
  { name: "broken-links", run: runAuditBrokenLinks as never },
  { name: "datasource-missing", run: runAuditDatasourceMissing as never },
  { name: "dead-templates", run: runAuditDeadTemplates as never },
  { name: "duplicates", run: runAuditDuplicates as never },
  { name: "empty-items", run: runAuditEmptyItems as never },
  // find-replace needs --pattern; only run if explicitly included AND pattern provided.
  { name: "find-replace", run: runAuditFindReplace as never, requiresExtraConfig: true },
  { name: "heavy-templates", run: runAuditHeavyTemplates as never },
  { name: "language-data", run: runAuditLanguageData as never },
  { name: "large-fields", run: runAuditLargeFields as never },
  { name: "missing-meta", run: runAuditMissingMeta as never },
  { name: "orphans", run: runAuditOrphans as never },
  { name: "page-design-orphans", run: runAuditPageDesignOrphans as never },
  { name: "personalization-broken", run: runAuditPersonalizationBroken as never },
  { name: "stale-content", run: runAuditStaleContent as never },
  { name: "stale-workflow", run: runAuditStaleWorkflow as never },
  { name: "unused-media", run: runAuditUnusedMedia as never },
];

export const auditNames = (): string[] => AUDIT_REGISTRY.map((a) => a.name);

interface SubAuditResult {
  name: string;
  findings: unknown[];
  ignored: unknown[];
  ignoredCount: number;
  durationMs: number;
  error?: string;
}

export const runAuditAll = async (options: AuditAllOptions): Promise<void> => {
  const logger = toLogger(options);

  const want = pickAuditsToRun(options);
  const { envName, configDir } = await resolveEnvForBaseline(options);
  const baseline =
    options.baseline || options.updateBaseline
      ? openBaseline({ envName, configDir, logger })
      : null;

  const subOptions = {
    ...options,
    // Each sub-audit prints its own report. Suppress that by forcing
    // --json + --quiet — we emit the consolidated report ourselves.
    json: true,
    quiet: true,
  };

  const results: SubAuditResult[] = [];
  for (const audit of want) {
    const start = Date.now();
    try {
      logger.verbose(`Running audit ${audit.name}…`);
      const raw = (await audit.run(subOptions)) as unknown[];
      const findings = Array.isArray(raw) ? raw : [];
      let kept = findings;
      let ignored: unknown[] = [];
      if (baseline && options.baseline) {
        const split = splitByBaseline(audit.name, findings, baseline);
        kept = split.kept;
        ignored = split.ignored;
      }
      if (baseline && options.updateBaseline) {
        for (const finding of findings) baseline.add(audit.name, finding, undefined);
      }
      results.push({
        name: audit.name,
        findings: kept,
        ignored,
        ignoredCount: ignored.length,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      results.push({
        name: audit.name,
        findings: [],
        ignored: [],
        ignoredCount: 0,
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (baseline && options.updateBaseline) {
    await baseline.flush();
    logger.info(`Baseline updated: ${baseline.filePath}`, "green");
  }

  const envelope = {
    command: "audit.all",
    environment: envName,
    baseline: baseline?.filePath ?? null,
    summary: buildAllSummary(results),
    counts: {
      auditsRun: results.length,
      auditsFailed: results.filter((r) => r.error).length,
      totalFindings: results.reduce((n, r) => n + r.findings.length, 0),
      totalIgnored: results.reduce((n, r) => n + r.ignoredCount, 0),
    },
    audits: Object.fromEntries(
      results.map((r) => [
        r.name,
        {
          findings: r.findings,
          ignoredCount: r.ignoredCount,
          durationMs: r.durationMs,
          ...(r.error && { error: r.error }),
        },
      ])
    ),
    // `results` mirrors the per-audit findings list for adapters that
    // walk a flat results array (CSV, Markdown table).
    results: results.flatMap((r) =>
      r.findings.map((f) => ({ audit: r.name, ...(f as Record<string, unknown>) }))
    ),
    count: results.reduce((n, r) => n + r.findings.length, 0),
  };

  const format = options.format ?? inferFormatOrDefault(options.output);
  const body = writeAuditOutput(envelope, { format, output: options.output });
  if (!options.output && !options.quiet) {
    // Echo to stdout when no file output requested.
    logger.json(envelope);
  } else if (options.output && !options.quiet) {
    logger.info(`Wrote ${options.output} (${envelope.count} findings).`, "green");
  } else if (!options.output) {
    // Quiet mode and no output file — still return; caller may read
    // the envelope via stdout if json mode.
    process.stdout.write(body);
  }
};

const pickAuditsToRun = (options: AuditAllOptions): AuditDef[] => {
  const include = options.include?.length
    ? new Set(options.include.map((s) => s.toLowerCase()))
    : null;
  const excludeAudit = new Set((options.excludeAudit ?? []).map((s) => s.toLowerCase()));
  return AUDIT_REGISTRY.filter((a) => {
    if (include) {
      // Explicit include list — only run what's listed.
      return include.has(a.name);
    }
    // Default: run everything except find-replace (needs --pattern).
    if (a.requiresExtraConfig) return false;
    if (excludeAudit.has(a.name)) return false;
    return true;
  });
};

const resolveEnvForBaseline = async (
  options: AuditAllOptions
): Promise<{ envName: string; configDir: string }> => {
  const { resolveEnvironment } = await import("@/shared/env");
  const { envName } = resolveEnvironment(options);
  const path = await import("node:path");
  const configDir = path.dirname(
    options.config?.endsWith(".json") ? options.config : (options.config ?? process.cwd())
  );
  return { envName, configDir: options.config ? configDir : process.cwd() };
};

const buildAllSummary = (results: SubAuditResult[]): string => {
  const totalFindings = results.reduce((n, r) => n + r.findings.length, 0);
  const failed = results.filter((r) => r.error).length;
  const parts: string[] = [];
  parts.push(`${results.length} audit${results.length === 1 ? "" : "s"} run`);
  parts.push(`${totalFindings} finding${totalFindings === 1 ? "" : "s"}`);
  if (failed > 0) parts.push(`${failed} audit${failed === 1 ? "" : "s"} failed`);
  return parts.join(", ") + ".";
};

const inferFormatOrDefault = (output: string | undefined): OutputFormat => {
  if (!output) return "json";
  const ext = output.toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "md" || ext === "markdown") return "markdown";
  return "json";
};
