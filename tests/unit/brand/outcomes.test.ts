import { describe, expect, it } from "vitest";
import {
  scoreToSarifLevel,
  summarizeOutcomes,
  type ReviewOutcome,
} from "../../../src/brand/review/outcomes";

const okOutcome = (
  label: string,
  overallScore: 1 | 2 | 3 | 4 | 5,
  sections: Array<{ section: string; score: 1 | 2 | 3 | 4 | 5; field?: string }> = []
): ReviewOutcome => ({
  kind: "ok",
  label,
  result: {
    overallScore,
    sectionResults: sections.map((s) => ({
      section: s.section,
      field: s.field,
      score: s.score,
    })),
  },
});

const errorOutcome = (label: string, message: string): ReviewOutcome => ({
  kind: "error",
  label,
  message,
});

describe("brand/review/outcomes — scoreToSarifLevel", () => {
  it("maps 1 and 2 to error", () => {
    expect(scoreToSarifLevel(1)).toBe("error");
    expect(scoreToSarifLevel(2)).toBe("error");
  });
  it("maps 3 to warning", () => {
    expect(scoreToSarifLevel(3)).toBe("warning");
  });
  it("maps 4 and 5 to note", () => {
    expect(scoreToSarifLevel(4)).toBe("note");
    expect(scoreToSarifLevel(5)).toBe("note");
  });
});

describe("brand/review/outcomes — summarizeOutcomes", () => {
  it("counts pass / fail by threshold and tracks lowest score", () => {
    const outcomes = [okOutcome("a.md", 5), okOutcome("b.md", 3), okOutcome("c.md", 1)];
    const summary = summarizeOutcomes(outcomes, 4);
    expect(summary).toEqual({
      total: 3,
      passed: 1,
      failed: 2,
      errored: 0,
      belowThreshold: 2,
      lowestScore: 1,
    });
  });

  it("treats every score as a pass when threshold is undefined", () => {
    const outcomes = [okOutcome("a.md", 1), okOutcome("b.md", 5)];
    const summary = summarizeOutcomes(outcomes, undefined);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.belowThreshold).toBe(0);
    expect(summary.lowestScore).toBe(1);
  });

  it("counts errors separately from threshold violations", () => {
    const outcomes = [okOutcome("a.md", 5), errorOutcome("b.md", "401"), okOutcome("c.md", 2)];
    const summary = summarizeOutcomes(outcomes, 4);
    expect(summary.total).toBe(3);
    expect(summary.errored).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.belowThreshold).toBe(1);
    expect(summary.lowestScore).toBe(2);
  });

  it("returns lowestScore undefined when every outcome is an error", () => {
    const outcomes = [errorOutcome("a.md", "boom"), errorOutcome("b.md", "boom")];
    const summary = summarizeOutcomes(outcomes, 4);
    expect(summary.lowestScore).toBeUndefined();
    expect(summary.errored).toBe(2);
    expect(summary.passed).toBe(0);
  });
});
