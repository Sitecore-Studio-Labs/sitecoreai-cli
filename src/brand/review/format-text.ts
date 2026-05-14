import type { BrandReviewScore } from "../api/types";
import { summarizeOutcomes, type OutcomeSummary, type ReviewOutcome } from "./outcomes";

/**
 * Compact, human-readable row for one outcome — emitted as each file
 * completes so operators see progress on long batch runs. The CLI
 * pipes this through its `Logger` so respects `--quiet` / `--json`.
 *
 *   ok    content/about.md          4/5   [Tone:4 Context:5]
 *   FAIL  content/landing.md        2/5   [Tone:2 Context:3 Voice:1]
 *   ERROR content/broken.md         (API error: token expired)
 */
export const formatTextRow = (
  outcome: ReviewOutcome,
  threshold: BrandReviewScore | undefined
): string => {
  if (outcome.kind === "error") {
    return `ERROR ${outcome.label}  (${outcome.message})`;
  }
  const score = outcome.result.overallScore;
  const status = threshold !== undefined && score < threshold ? "FAIL " : "ok   ";
  const sections = outcome.result.sectionResults
    .map((section) => `${section.section.split(" ")[0]}:${section.score}`)
    .join(" ");
  const sectionsBlock = sections ? `  [${sections}]` : "";
  return `${status}${outcome.label}  ${score}/5${sectionsBlock}`;
};

/**
 * End-of-run summary line. One verdict the operator can scan; the
 * detail rows above contextualize.
 */
export const formatTextSummary = (
  summary: OutcomeSummary,
  threshold: BrandReviewScore | undefined
): string => {
  const parts: string[] = [];
  parts.push(`${summary.total} file(s)`);
  parts.push(`${summary.passed} pass`);
  if (threshold !== undefined) {
    parts.push(`${summary.failed} below threshold ${threshold}`);
  }
  if (summary.errored > 0) {
    parts.push(`${summary.errored} error(s)`);
  }
  if (summary.lowestScore !== undefined) {
    parts.push(`lowest score: ${summary.lowestScore}/5`);
  }
  return parts.join("  ·  ");
};

/**
 * Build a multi-line text report for non-streaming callers (e.g.
 * `--output report.txt`). The CLI normally streams rows as files
 * complete, but a fully-buffered report is useful for tests and
 * artifact uploads.
 */
export const buildTextReport = (
  outcomes: readonly ReviewOutcome[],
  threshold: BrandReviewScore | undefined
): string => {
  const lines = outcomes.map((outcome) => formatTextRow(outcome, threshold));
  const summary = summarizeOutcomes(outcomes, threshold);
  lines.push("");
  lines.push(formatTextSummary(summary, threshold));
  return lines.join("\n");
};
