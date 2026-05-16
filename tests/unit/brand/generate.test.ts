import { describe, expect, it } from "vitest";
import { _aggregateOverall } from "../../../src/brand/review/generate";
import type { BrandReviewSectionResult } from "../../../src/brand/api/types";

const row = (
  score: 1 | 2 | 3 | 4 | 5,
  partial: Partial<BrandReviewSectionResult> = {}
): BrandReviewSectionResult => ({
  section: partial.section ?? "section-uuid",
  field: partial.field,
  score,
  explanation: partial.explanation,
  suggestions: partial.suggestions,
});

describe("brand/review/generate — aggregateOverall", () => {
  it("returns 5 for empty input (no findings = max alignment)", () => {
    expect(_aggregateOverall([])).toBe(5);
  });

  it("picks the minimum score across all rows", () => {
    expect(_aggregateOverall([row(5), row(3), row(2)])).toBe(2);
  });

  it("treats field-level rows the same as section-level rows", () => {
    expect(_aggregateOverall([row(4, { field: undefined }), row(1, { field: "f-uuid" })])).toBe(1);
  });

  it("clamps to 1 when every row is 1", () => {
    expect(_aggregateOverall([row(1), row(1)])).toBe(1);
  });

  it("returns 5 when every row is 5", () => {
    expect(_aggregateOverall([row(5), row(5)])).toBe(5);
  });
});
