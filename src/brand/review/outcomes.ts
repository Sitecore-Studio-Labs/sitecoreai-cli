import type { BrandReviewResult, BrandReviewScore } from "../api/types";

/**
 * One file's outcome from a batch review run. Per-item independence
 * is important — a single API failure must not lose the results of
 * peer files in the batch (see `failFast` for opt-in stop-on-error).
 */
export type ReviewOutcome =
  | {
      kind: "ok";
      /** Caller-supplied label (file path for CLI, free-form for SDK). */
      label: string;
      result: BrandReviewResult;
    }
  | {
      kind: "error";
      label: string;
      /** Human-readable message; full ScaiError fields are preserved on `cause`. */
      message: string;
      cause?: unknown;
    };

/**
 * Map a 1–5 score to a SARIF severity level. The breakpoints map to
 * the documented brand-compliance domain:
 *
 *   1, 2  → error    (poor alignment; CI gate fail by default)
 *   3     → warning  (acceptable but suggests improvement)
 *   4, 5  → note     (well-aligned; emitted only for traceability)
 */
export const scoreToSarifLevel = (score: BrandReviewScore): "error" | "warning" | "note" => {
  if (score <= 2) return "error";
  if (score === 3) return "warning";
  return "note";
};

/** Per-outcome summary used by every formatter for traversal. */
export interface OutcomeSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  belowThreshold: number;
  lowestScore?: BrandReviewScore;
}

/**
 * Compute the summary statistics over a batch. `threshold` is the
 * 1–5 minimum acceptable score; an undefined threshold disables the
 * `belowThreshold` count (it stays 0). Per-API errors are counted
 * separately from scoring.
 */
export const summarizeOutcomes = (
  outcomes: readonly ReviewOutcome[],
  threshold?: BrandReviewScore
): OutcomeSummary => {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let belowThreshold = 0;
  let lowestScore: BrandReviewScore | undefined;

  for (const outcome of outcomes) {
    if (outcome.kind === "error") {
      errored += 1;
      continue;
    }
    const score = outcome.result.overallScore;
    if (lowestScore === undefined || score < lowestScore) {
      lowestScore = score;
    }
    if (threshold !== undefined && score < threshold) {
      belowThreshold += 1;
      failed += 1;
    } else {
      passed += 1;
    }
  }

  return {
    total: outcomes.length,
    passed,
    failed,
    errored,
    belowThreshold,
    lowestScore,
  };
};
