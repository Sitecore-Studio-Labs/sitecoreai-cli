import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import {
  computeExitCode,
  detectInputFormat,
  parseSectionSelectors,
  resolveReviewInputs,
} from "../../../src/brand/tasks/review";
import type { ReviewOutcome } from "../../../src/brand/review/outcomes";

const okOutcome = (label: string, overallScore: 1 | 2 | 3 | 4 | 5): ReviewOutcome => ({
  kind: "ok",
  label,
  result: { overallScore, sectionResults: [] },
});

const errorOutcome = (label: string, message = "boom"): ReviewOutcome => ({
  kind: "error",
  label,
  message,
});

describe("brand/tasks/review — detectInputFormat", () => {
  it("maps markdown extensions to 'markdown'", () => {
    expect(detectInputFormat("content/a.md")).toBe("markdown");
    expect(detectInputFormat("content/b.markdown")).toBe("markdown");
    expect(detectInputFormat("content/c.mdx")).toBe("markdown");
  });
  it("maps .json to 'json'", () => {
    expect(detectInputFormat("data/x.json")).toBe("json");
  });
  it("falls back to 'text' for unknown extensions", () => {
    expect(detectInputFormat("README")).toBe("text");
    expect(detectInputFormat("notes.txt")).toBe("text");
    expect(detectInputFormat("page.html")).toBe("text");
  });
  it("is case-insensitive on the extension", () => {
    expect(detectInputFormat("Content/About.MD")).toBe("markdown");
    expect(detectInputFormat("Data/X.JSON")).toBe("json");
  });
});

describe("brand/tasks/review — computeExitCode", () => {
  it("returns 0 when every file passes and no errors", () => {
    expect(computeExitCode([okOutcome("a", 5), okOutcome("b", 4)], 4)).toBe(0);
  });
  it("returns 1 when at least one score is below threshold", () => {
    expect(computeExitCode([okOutcome("a", 5), okOutcome("b", 3)], 4)).toBe(1);
  });
  it("returns 7 when at least one API error occurred and no threshold violation", () => {
    expect(computeExitCode([okOutcome("a", 5), errorOutcome("b")], 4)).toBe(7);
  });
  it("threshold violation wins over API errors (1 over 7)", () => {
    expect(computeExitCode([errorOutcome("a"), okOutcome("b", 2)], 4)).toBe(1);
  });
  it("returns 0 when threshold is unset even with low scores", () => {
    expect(computeExitCode([okOutcome("a", 1)], undefined)).toBe(0);
  });
});

describe("brand/tasks/review — resolveReviewInputs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-brand-review-"));
    fs.mkdirSync(path.join(tmpDir, "content"));
    fs.writeFileSync(path.join(tmpDir, "content", "about.md"), "# About");
    fs.writeFileSync(path.join(tmpDir, "content", "landing.md"), "# Landing");
    fs.writeFileSync(path.join(tmpDir, "content", "ignored.txt"), "ignored");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves positional file paths", async () => {
    const resolved = await resolveReviewInputs(
      ["content/about.md", "content/landing.md"],
      [],
      tmpDir
    );
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toBe(path.join(tmpDir, "content", "about.md"));
  });

  it("expands a glob pattern", async () => {
    const resolved = await resolveReviewInputs([], ["content/*.md"], tmpDir);
    expect(resolved).toHaveLength(2);
    expect(resolved.every((p) => p.endsWith(".md"))).toBe(true);
  });

  it("deduplicates across positional and glob", async () => {
    const resolved = await resolveReviewInputs(["content/about.md"], ["content/*.md"], tmpDir);
    expect(resolved).toHaveLength(2);
  });

  it("errors when a positional file is missing", async () => {
    await expect(resolveReviewInputs(["content/missing.md"], [], tmpDir)).rejects.toThrow(
      /Input files not found/
    );
  });

  it("filters out directories silently", async () => {
    const resolved = await resolveReviewInputs(["content"], [], tmpDir);
    expect(resolved).toHaveLength(0);
  });
});

describe("brand/tasks/review — parseSectionSelectors", () => {
  it("returns undefined for empty / missing input (API evaluates all sections)", () => {
    expect(parseSectionSelectors(undefined)).toBeUndefined();
    expect(parseSectionSelectors([])).toBeUndefined();
  });

  it("parses bare section UUIDs into Section[] without fieldIds", () => {
    const result = parseSectionSelectors([
      "0b3197be-f0b7-462a-a2e5-3388a132ee3f",
      "1aaa2222-bbbb-cccc-dddd-eeeeeeeeeeee",
    ]);
    expect(result).toEqual([
      { sectionId: "0b3197be-f0b7-462a-a2e5-3388a132ee3f", fieldIds: undefined },
      { sectionId: "1aaa2222-bbbb-cccc-dddd-eeeeeeeeeeee", fieldIds: undefined },
    ]);
  });

  it("parses <sectionId>:<fieldId> into Section.fieldIds", () => {
    const result = parseSectionSelectors([
      "0b3197be-f0b7-462a-a2e5-3388a132ee3f:8cf1b172-0277-4aa3-9bb4-252f09f148fd",
    ]);
    expect(result).toEqual([
      {
        sectionId: "0b3197be-f0b7-462a-a2e5-3388a132ee3f",
        fieldIds: ["8cf1b172-0277-4aa3-9bb4-252f09f148fd"],
      },
    ]);
  });

  it("merges multiple field selections for the same sectionId", () => {
    const result = parseSectionSelectors(["sec1:field-a", "sec1:field-b", "sec2"]);
    expect(result).toEqual([
      { sectionId: "sec1", fieldIds: ["field-a", "field-b"] },
      { sectionId: "sec2", fieldIds: undefined },
    ]);
  });

  it("throws INPUT_INVALID for entries with an empty sectionId", () => {
    expect(() => parseSectionSelectors([":field-only"])).toThrow(/Invalid --section-id/);
  });
});
