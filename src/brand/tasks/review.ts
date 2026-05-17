import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import packageJson from "../../../package.json";
import { toLogger, inputError } from "@/shared/cli-tasks";
import type { CommonOptions } from "@/shared/cli-options";
import { generateBrandReview } from "../review/generate";
import { resolveBrandClient } from "../credential";
import type { BrandApiClientOptions } from "../api/client";
import type { BrandReviewInput, BrandReviewScore, BrandReviewSectionSelector } from "../api/types";
import { summarizeOutcomes, type ReviewOutcome } from "../review/outcomes";
import { buildJsonReport, type BrandReviewJsonReport } from "../review/format-json";
import { buildSarifReport, type SarifReport } from "../review/format-sarif";
import { buildTextReport, formatTextRow, formatTextSummary } from "../review/format-text";

export type BrandReviewFormat = "text" | "json" | "sarif";

export interface BrandReviewCommandOptions extends CommonOptions {
  environmentName?: string;
  /** Override the orgId resolved from the active env profile. */
  orgId?: string;
  /** Positional file paths to review. Mixed with `--glob` results. */
  inputs?: string[];
  /** Glob pattern(s) relative to the project root. */
  glob?: string[];
  /** Brand kit ID to evaluate against. Required for v1. */
  kit?: string;
  /**
   * Restrict the review to these brand kit section UUIDs. Each value
   * may be a bare section UUID, or `<sectionId>:<fieldId>` to narrow
   * to a specific subsection within that section. Section names
   * (e.g. "Tone of Voice") are NOT accepted — name lookup lands when
   * the Brand Management read primitives ship.
   */
  sectionId?: string[];
  /** 1–5; exit non-zero if any score is below this. */
  threshold?: number;
  /** Parallel in-flight reviews. Defaults to 4. */
  concurrency?: number;
  /** Stop scheduling on first failure (in-flight still drain). */
  failFast?: boolean;
  /** Output format. Defaults to `text`. */
  format?: BrandReviewFormat;
  /** Write the formatted report to a file instead of stdout. */
  output?: string;
  /** Max files to review without `--force`. Defaults to 1000. */
  limit?: number;
  /** Bypass the `--limit` guardrail. */
  force?: boolean;
  /** Print the resolved file list + count and exit without calling the API. */
  whatIf?: boolean;
}

export interface BrandReviewRunResult {
  outcomes: ReviewOutcome[];
  exitCode: number;
  /** What scai _wrote_ — useful for tests and JSON-mode callers. */
  report?: string;
  json?: BrandReviewJsonReport;
  sarif?: SarifReport;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_LIMIT = 1000;

const isReviewFormat = (value: unknown): value is BrandReviewFormat =>
  value === "text" || value === "json" || value === "sarif";

const asThreshold = (raw: number | undefined): BrandReviewScore | undefined => {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw) || raw < 1 || raw > 5) {
    throw inputError(
      `Invalid --threshold ${raw}.`,
      "Threshold must be an integer between 1 and 5 inclusive."
    );
  }
  return Math.round(raw) as BrandReviewScore;
};

/**
 * Detect a file's content-format hint from its extension. The Brand
 * Review API uses a flexible `input` map and doesn't surface a
 * format-discriminator field today — this helper exists for callers
 * that want a stable categorization (e.g. logging, future routing of
 * `.json` content through an `ExtractableFile` reference instead of
 * raw text). Returns one of `"text" | "markdown" | "json"`.
 */
export type InputFormatHint = "text" | "markdown" | "json";

export const detectInputFormat = (filePath: string): InputFormatHint => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown" || ext === ".mdx") return "markdown";
  if (ext === ".json") return "json";
  return "text";
};

/**
 * Parse CLI `--section-id` values into the Brand Review API's
 * `Section[]` selector shape.
 *
 * Each value is either:
 *   - `<sectionId>`              → section-level evaluation
 *   - `<sectionId>:<fieldId>`    → field-level evaluation (multiple
 *                                  `--section-id <sectionId>:<a>`
 *                                  occurrences merge into one
 *                                  `Section` entry)
 *
 * Multiple values for the same sectionId accumulate into the
 * section's `fieldIds[]`. An empty / undefined input list returns
 * `undefined` (= API evaluates every section).
 */
export const parseSectionSelectors = (
  raw: readonly string[] | undefined
): BrandReviewSectionSelector[] | undefined => {
  if (!raw?.length) return undefined;
  const bySection = new Map<string, Set<string>>();
  for (const entry of raw) {
    const [sectionId, fieldId] = entry.split(":");
    if (!sectionId) {
      throw inputError(
        `Invalid --section-id value '${entry}'.`,
        "Use <sectionId> or <sectionId>:<fieldId>. IDs are UUIDs from the Brand Management API."
      );
    }
    if (!bySection.has(sectionId)) {
      bySection.set(sectionId, new Set());
    }
    if (fieldId) {
      bySection.get(sectionId)!.add(fieldId);
    }
  }
  return Array.from(bySection.entries()).map(([sectionId, fieldIds]) => ({
    sectionId,
    fieldIds: fieldIds.size > 0 ? Array.from(fieldIds) : undefined,
  }));
};

/**
 * Resolve positional file paths + glob patterns to a deduplicated,
 * sorted list of absolute file paths. Resolution rules:
 *
 *   - Positional paths must exist; if any are missing the call
 *     errors with INPUT_INVALID listing the missing entries.
 *   - Glob patterns expand relative to `cwd`.
 *   - Duplicates across positional+glob are removed.
 *   - Directories and non-files are filtered out — Brand Review
 *     operates on file content, not directory listings.
 *
 * Returns the resolved files in input order (positionals first,
 * then glob hits in their natural order).
 */
export const resolveReviewInputs = async (
  positionals: readonly string[],
  globs: readonly string[],
  cwd: string
): Promise<string[]> => {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];

  for (const positional of positionals) {
    const abs = path.resolve(cwd, positional);
    if (!fs.existsSync(abs)) {
      missing.push(positional);
      continue;
    }
    const stat = fs.statSync(abs);
    if (!stat.isFile()) continue;
    if (!seen.has(abs)) {
      seen.add(abs);
      resolved.push(abs);
    }
  }

  if (missing.length > 0) {
    throw inputError(
      `Input files not found: ${missing.join(", ")}.`,
      "Check the paths or use --glob to expand a pattern."
    );
  }

  if (globs.length > 0) {
    const matched = await fg([...globs], {
      cwd,
      absolute: true,
      onlyFiles: true,
      dot: false,
    });
    for (const abs of matched) {
      if (!seen.has(abs)) {
        seen.add(abs);
        resolved.push(abs);
      }
    }
  }

  return resolved;
};

const buildReviewInput = (filePath: string, cwd: string): BrandReviewInput => {
  const content = fs.readFileSync(filePath, "utf8");
  const relative = path.relative(cwd, filePath);
  return {
    text: content,
    label: relative || filePath,
  };
};

interface FanOutOptions {
  inputs: BrandReviewInput[];
  client: BrandApiClientOptions;
  kit: string;
  sections: BrandReviewSectionSelector[] | undefined;
  concurrency: number;
  failFast: boolean;
  threshold: BrandReviewScore | undefined;
  onProgress: (outcome: ReviewOutcome, index: number) => void;
}

/**
 * Bounded-concurrency fan-out with per-item error capture. Each
 * worker pulls the next index from a shared counter; failures are
 * captured into the outcome array instead of aborting peers (unless
 * `failFast` is set). Order matches input order.
 *
 * Not generalized into `mapWithConcurrency` because that helper
 * fail-fasts — a property we want NOT to have here: a 500 on one
 * file shouldn't lose results for 99 peers.
 */
const fanOutReviews = async (options: FanOutOptions): Promise<ReviewOutcome[]> => {
  const { inputs, client, kit, sections, concurrency, failFast, threshold, onProgress } = options;
  const outcomes: ReviewOutcome[] = new Array(inputs.length);
  let nextIndex = 0;
  let stopped = false;

  const runOne = async (): Promise<void> => {
    while (!stopped) {
      const index = nextIndex++;
      if (index >= inputs.length) return;
      const input = inputs[index];
      const label = input.label ?? `input[${index}]`;
      try {
        const result = await generateBrandReview({
          client,
          input,
          selector: { brandKitId: kit, sections },
        });
        const outcome: ReviewOutcome = { kind: "ok", label, result };
        outcomes[index] = outcome;
        onProgress(outcome, index);
        if (failFast && threshold !== undefined && result.overallScore < threshold) {
          stopped = true;
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const outcome: ReviewOutcome = { kind: "error", label, message, cause: error };
        outcomes[index] = outcome;
        onProgress(outcome, index);
        if (failFast) {
          stopped = true;
          return;
        }
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => runOne()));
  return outcomes.filter((entry): entry is ReviewOutcome => entry !== undefined);
};

/**
 * Compute the CLI exit code for a batch review run.
 *
 *   0  → no API errors and no scores below threshold
 *   1  → threshold violated by at least one file
 *   7  → at least one API call failed (`BRAND_API_FAILED`)
 *
 * Threshold violations and API errors can co-occur — when both fire,
 * the threshold violation wins (1) so CI failure modes are
 * distinguishable from infrastructure failures.
 */
export const computeExitCode = (
  outcomes: readonly ReviewOutcome[],
  threshold: BrandReviewScore | undefined
): number => {
  const summary = summarizeOutcomes(outcomes, threshold);
  if (summary.belowThreshold > 0) return 1;
  if (summary.errored > 0) return 7;
  return 0;
};

/**
 * Run a batch Brand Review.
 *
 * The CLI verb is a thin wrapper around this — pass the same options
 * and inspect the returned `BrandReviewRunResult` to drive exit
 * codes, stdout writes, or downstream tooling. SDK consumers should
 * use this directly (exported through `@sitecoreai-labs/sitecoreai-cli/unstable/brand`).
 */
export const runBrandReview = async (
  options: BrandReviewCommandOptions
): Promise<BrandReviewRunResult> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const { orgId, credential } = resolveBrandClient(options);

  if (!options.kit) {
    throw inputError(
      "Brand kit ID is required.",
      "Pass --kit <id>. List kits with `scai brand kits list` (coming in a follow-up slice)."
    );
  }

  const format: BrandReviewFormat = isReviewFormat(options.format) ? options.format : "text";
  const threshold = asThreshold(options.threshold);
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);

  const cwd = configPath;
  const filePaths = await resolveReviewInputs(options.inputs ?? [], options.glob ?? [], cwd);
  if (filePaths.length === 0) {
    throw inputError(
      "No input files matched.",
      "Provide file paths as positional args or use --glob <pattern>."
    );
  }
  if (filePaths.length > limit && !options.force) {
    throw inputError(
      `Resolved ${filePaths.length} files which exceeds --limit ${limit}.`,
      "Increase --limit, narrow --glob, or pass --force to override. Each file is a paid API call."
    );
  }

  if (options.whatIf) {
    logger.info(
      `--what-if: would review ${filePaths.length} file(s) against kit '${options.kit}'.`
    );
    for (const filePath of filePaths) {
      logger.info(`  ${path.relative(cwd, filePath)}`);
    }
    return { outcomes: [], exitCode: 0 };
  }

  const inputs = filePaths.map((p) => buildReviewInput(p, cwd));
  const client: BrandApiClientOptions = { orgId, credential };
  const sections = parseSectionSelectors(options.sectionId);

  // Text format streams as files complete. JSON / SARIF buffer (order
  // matters for those payloads and the formats aggregate per-file
  // sections, so streaming would be a wire-format leak).
  const onProgress =
    format === "text"
      ? (outcome: ReviewOutcome): void => {
          logger.info(formatTextRow(outcome, threshold));
        }
      : (): void => {
          // No-op — buffered output formats render at end.
        };

  const outcomes = await fanOutReviews({
    inputs,
    client,
    kit: options.kit,
    sections,
    concurrency,
    failFast: Boolean(options.failFast),
    threshold,
    onProgress,
  });

  const exitCode = computeExitCode(outcomes, threshold);
  const result: BrandReviewRunResult = { outcomes, exitCode };

  if (format === "text") {
    const summary = summarizeOutcomes(outcomes, threshold);
    const summaryLine = formatTextSummary(summary, threshold);
    if (options.output) {
      fs.writeFileSync(options.output, buildTextReport(outcomes, threshold), "utf8");
      logger.info(`Wrote text report to ${options.output}.`);
    } else {
      logger.info("");
      logger.info(summaryLine);
    }
    result.report = buildTextReport(outcomes, threshold);
  } else if (format === "json") {
    const report = buildJsonReport(outcomes, threshold);
    const serialized = JSON.stringify(report, null, 2);
    if (options.output) {
      fs.writeFileSync(options.output, serialized, "utf8");
      logger.info(`Wrote JSON report to ${options.output}.`);
    } else {
      // Direct stdout write — logger.info would prepend formatting
      // that breaks JSON consumers piping to jq.
      process.stdout.write(serialized + "\n");
    }
    result.report = serialized;
    result.json = report;
  } else {
    const driverVersion = (packageJson as { version?: string }).version ?? "0.0.0";
    const report = buildSarifReport(outcomes, threshold, driverVersion);
    const serialized = JSON.stringify(report, null, 2);
    if (options.output) {
      fs.writeFileSync(options.output, serialized, "utf8");
      logger.info(`Wrote SARIF report to ${options.output}.`);
    } else {
      process.stdout.write(serialized + "\n");
    }
    result.report = serialized;
    result.sarif = report;
  }

  return result;
};
