import type { BrandReviewScore } from "../api/types";
import { summarizeOutcomes, type OutcomeSummary, type ReviewOutcome } from "./outcomes";

export interface BrandReviewJsonReport {
  schemaVersion: 1;
  threshold?: BrandReviewScore;
  summary: OutcomeSummary;
  results: Array<
    | {
        kind: "ok";
        label: string;
        overallScore: BrandReviewScore;
        sectionResults: Array<{
          section: string;
          field?: string;
          score: BrandReviewScore;
          explanation?: string;
          suggestions?: string[];
        }>;
      }
    | { kind: "error"; label: string; message: string }
  >;
}

/**
 * Aggregated JSON payload for a batch review run. Order matches the
 * input order; `kind: "error"` entries preserve the per-file failure
 * message so consumers don't have to cross-reference exit codes.
 *
 * `raw` server fields from each `BrandReviewResult` are intentionally
 * dropped here — they're useful for ad-hoc inspection but bloat the
 * payload and aren't part of the stable contract.
 */
export const buildJsonReport = (
  outcomes: readonly ReviewOutcome[],
  threshold?: BrandReviewScore
): BrandReviewJsonReport => ({
  schemaVersion: 1,
  threshold,
  summary: summarizeOutcomes(outcomes, threshold),
  results: outcomes.map((outcome) => {
    if (outcome.kind === "error") {
      return { kind: "error", label: outcome.label, message: outcome.message };
    }
    return {
      kind: "ok",
      label: outcome.label,
      overallScore: outcome.result.overallScore,
      sectionResults: outcome.result.sectionResults.map((section) => ({
        section: section.section,
        field: section.field,
        score: section.score,
        explanation: section.explanation,
        suggestions: section.suggestions,
      })),
    };
  }),
});
