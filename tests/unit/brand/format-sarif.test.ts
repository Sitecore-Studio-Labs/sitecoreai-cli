import { describe, expect, it } from "vitest";
import { buildSarifReport } from "../../../src/brand/review/format-sarif";
import type { ReviewOutcome } from "../../../src/brand/review/outcomes";

const okOutcome = (
  label: string,
  overallScore: 1 | 2 | 3 | 4 | 5,
  sections: Array<{
    section: string;
    score: 1 | 2 | 3 | 4 | 5;
    field?: string;
    explanation?: string;
  }>
): ReviewOutcome => ({
  kind: "ok",
  label,
  result: {
    overallScore,
    sectionResults: sections.map((s) => ({
      section: s.section,
      field: s.field,
      score: s.score,
      explanation: s.explanation,
    })),
  },
});

describe("brand/review/format-sarif — buildSarifReport", () => {
  it("emits SARIF 2.1.0 with the scai driver", () => {
    const report = buildSarifReport([], undefined, "0.0.4");
    expect(report.version).toBe("2.1.0");
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0].tool.driver.name).toBe("scai-brand-review");
    expect(report.runs[0].tool.driver.version).toBe("0.0.4");
  });

  it("emits scores 1–3 by default and omits 4–5 (no-threshold mode)", () => {
    const outcome = okOutcome("content/a.md", 2, [
      { section: "Tone of Voice", score: 1 },
      { section: "Brand Context", score: 3 },
      { section: "Global Goals", score: 4 },
      { section: "Glossary", score: 5 },
    ]);
    const report = buildSarifReport([outcome], undefined, "0.0.4");
    const results = report.runs[0].results;
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.level)).toEqual(["error", "warning"]);
  });

  it("filters by threshold strictly less than", () => {
    const outcome = okOutcome("content/a.md", 3, [
      { section: "Tone", score: 2 },
      { section: "Context", score: 3 },
      { section: "Voice", score: 4 },
    ]);
    const report = buildSarifReport([outcome], 4, "0.0.4");
    const results = report.runs[0].results;
    // threshold 4 → scores < 4 are emitted: score 2 and 3
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.level)).toEqual(["error", "warning"]);
  });

  it("emits api-error results for failed outcomes with their file path", () => {
    const outcome: ReviewOutcome = {
      kind: "error",
      label: "content/broken.md",
      message: "Token expired",
    };
    const report = buildSarifReport([outcome], undefined, "0.0.4");
    const results = report.runs[0].results;
    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe("brand/api-error");
    expect(results[0].level).toBe("error");
    expect(results[0].message.text).toBe("Token expired");
    expect(results[0].locations[0].physicalLocation.artifactLocation.uri).toBe("content/broken.md");
  });

  it("deduplicates rules in the driver across multiple results", () => {
    const outcome = okOutcome("a.md", 2, [
      { section: "Tone of Voice", score: 1 },
      { section: "Tone of Voice", score: 2 },
    ]);
    const report = buildSarifReport([outcome], undefined, "0.0.4");
    const rules = report.runs[0].tool.driver.rules;
    expect(rules.filter((r) => r.id === "brand/tone-of-voice")).toHaveLength(1);
  });

  it("includes the explanation in the message text", () => {
    const outcome = okOutcome("a.md", 2, [
      { section: "Tone", score: 2, explanation: "Too formal for the brand voice." },
    ]);
    const report = buildSarifReport([outcome], undefined, "0.0.4");
    expect(report.runs[0].results[0].message.text).toContain("Too formal for the brand voice");
    expect(report.runs[0].results[0].message.text).toContain("score 2/5");
  });
});
