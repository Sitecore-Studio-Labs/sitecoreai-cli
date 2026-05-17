import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatAuditOutput,
  inferFormatFromExtension,
  writeAuditOutput,
} from "../../../src/hygiene/output-adapters";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-output-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const envelope = {
  command: "audit.broken-links.list",
  environment: "sandbox",
  count: 2,
  data: [
    { itemId: "a", path: "/foo", brokenRefs: 3 },
    { itemId: "b", path: "/bar", brokenRefs: 1 },
  ],
  summary: "2 items found.",
};

describe("inferFormatFromExtension", () => {
  it("recognises .json, .csv, .md, .markdown", () => {
    expect(inferFormatFromExtension("report.json")).toBe("json");
    expect(inferFormatFromExtension("report.csv")).toBe("csv");
    expect(inferFormatFromExtension("report.md")).toBe("markdown");
    expect(inferFormatFromExtension("report.markdown")).toBe("markdown");
  });
  it("returns undefined for unknown extensions", () => {
    expect(inferFormatFromExtension("report.txt")).toBeUndefined();
  });
});

describe("formatAuditOutput — json", () => {
  it("produces pretty-printed JSON", () => {
    const out = formatAuditOutput(envelope, "json");
    expect(out).toContain('"command": "audit.broken-links.list"');
    expect(out).toContain('"itemId": "a"');
  });
});

describe("formatAuditOutput — csv", () => {
  it("emits a header + one row per result", () => {
    const out = formatAuditOutput(envelope, "csv");
    const lines = out.split("\n");
    expect(lines[0]).toBe("itemId,path,brokenRefs");
    expect(lines[1]).toBe("a,/foo,3");
    expect(lines[2]).toBe("b,/bar,1");
  });

  it("returns empty string for empty results", () => {
    expect(formatAuditOutput({ ...envelope, data: [] }, "csv")).toBe("");
  });

  it("quotes values containing commas / quotes / newlines", () => {
    const out = formatAuditOutput(
      {
        ...envelope,
        data: [{ note: 'has "quote", and comma' }],
      },
      "csv"
    );
    expect(out).toContain('"has ""quote"", and comma"');
  });
});

describe("formatAuditOutput — markdown", () => {
  it("renders a heading + summary + table for flat rows", () => {
    const out = formatAuditOutput(envelope, "markdown");
    expect(out).toContain("# broken-links list");
    expect(out).toContain("**Environment**: `sandbox`");
    expect(out).toContain("**Summary**: 2 items found.");
    expect(out).toMatch(/\| itemId \| path \| brokenRefs \|/);
  });

  it("falls back to fenced JSON when rows have nested objects", () => {
    const out = formatAuditOutput(
      {
        ...envelope,
        data: [{ itemId: "a", nested: { deep: "value" } }],
      },
      "markdown"
    );
    expect(out).toContain("```json");
  });

  it('emits "no findings" line when results is empty', () => {
    const out = formatAuditOutput({ ...envelope, data: [], count: 0 }, "markdown");
    expect(out).toContain("_No findings._");
  });

  it("renders audit.all envelopes with a summary callout + breakdown table + per-audit sections", () => {
    const allEnvelope = {
      command: "audit.all",
      environment: "sandbox",
      summary: "5 audits run, 7 findings.",
      counts: {
        auditsRun: 5,
        auditsFailed: 0,
        totalFindings: 7,
        totalIgnored: 2,
      },
      audits: {
        "broken-links": {
          findings: [{ itemId: "a", path: "/x/a", brokenRefs: 1 }],
          ignoredCount: 0,
          durationMs: 250,
        },
        orphans: {
          findings: [],
          ignoredCount: 2,
          durationMs: 100,
        },
        "stale-content": {
          findings: [],
          ignoredCount: 0,
          durationMs: 50,
          error: "Auth timed out",
        },
      },
      results: [],
      count: 0,
    };
    const out = formatAuditOutput(allEnvelope, "markdown");
    expect(out).toContain("# Audit report — `sandbox`");
    expect(out).toContain("> **Summary**");
    expect(out).toContain("- Total findings: **7**");
    expect(out).toContain("- Ignored by baseline: **2**");
    expect(out).toContain("## Breakdown");
    expect(out).toMatch(/\| broken-links \| 1 \|/);
    expect(out).toContain("## broken-links");
    expect(out).toContain("## stale-content");
    expect(out).toContain("⚠️ Audit failed: `Auth timed out`");
    // Audit with zero findings + no error should not get a `##` section.
    expect(out).not.toContain("## orphans");
  });
});

describe("writeAuditOutput", () => {
  it("writes the formatted body to the given file path", () => {
    const file = path.join(dir, "report.csv");
    writeAuditOutput(envelope, { output: file, format: "csv" });
    const content = fs.readFileSync(file, "utf8");
    expect(content.split("\n")[0]).toBe("itemId,path,brokenRefs");
  });

  it("creates missing intermediate directories", () => {
    const file = path.join(dir, "nested", "deep", "report.json");
    writeAuditOutput(envelope, { output: file, format: "json" });
    expect(fs.existsSync(file)).toBe(true);
  });

  it("returns the formatted body even when no output path is set", () => {
    const body = writeAuditOutput(envelope, { format: "csv" });
    expect(body).toContain("itemId,path,brokenRefs");
  });

  it("defaults to json format when no format option is given", () => {
    const body = writeAuditOutput(envelope, {});
    expect(body).toContain('"command": "audit.broken-links.list"');
  });
});

describe("formatAuditOutput — default / unknown format", () => {
  it("falls back to pretty JSON for an unrecognised format token", () => {
    const out = formatAuditOutput(envelope, "yaml" as never);
    expect(out).toContain('"command": "audit.broken-links.list"');
  });
});

describe("formatAuditOutput — csv edge cases", () => {
  it("joins array cell values with a semicolon", () => {
    const out = formatAuditOutput({ ...envelope, data: [{ tags: ["a", "b", "c"] }] }, "csv");
    expect(out.split("\n")[1]).toBe("a; b; c");
  });

  it("JSON-stringifies an array of objects inside a cell", () => {
    const out = formatAuditOutput({ ...envelope, data: [{ refs: [{ id: 1 }, { id: 2 }] }] }, "csv");
    expect(out).toContain('{""id"":1}');
  });

  it("JSON-stringifies a nested object cell", () => {
    const out = formatAuditOutput({ ...envelope, data: [{ meta: { deep: "value" } }] }, "csv");
    expect(out).toContain('{""deep"":""value""}');
  });

  it("emits an empty cell for a null or undefined value", () => {
    const out = formatAuditOutput({ ...envelope, data: [{ itemId: "a", note: null }] }, "csv");
    // header itemId,note → row "a," (note column blank)
    expect(out.split("\n")[1]).toBe("a,");
  });

  it("stringifies boolean and number values without quoting", () => {
    const out = formatAuditOutput({ ...envelope, data: [{ flag: true, n: 7 }] }, "csv");
    expect(out.split("\n")[1]).toBe("true,7");
  });

  it("skips non-object rows when deriving columns and rows", () => {
    const out = formatAuditOutput({ ...envelope, data: ["scalar", { itemId: "a" }] }, "csv");
    // The scalar row is skipped; only the object row is emitted.
    expect(out.split("\n")).toEqual(["itemId", "a"]);
  });
});

describe("formatAuditOutput — markdown single-audit extras", () => {
  it("renders extra scalar envelope fields as bullet metadata", () => {
    const out = formatAuditOutput(
      { ...envelope, ignoredCount: 3, durationMs: 1200, audits: { x: {} } },
      "markdown"
    );
    expect(out).toContain("**Ignored by baseline**: 3");
    expect(out).toContain("**durationMs**: 1200");
    // `audits` is an excluded key and never surfaces as a bullet.
    expect(out).not.toContain("**audits**");
  });

  it("omits the count bullet when count is not a number", () => {
    const out = formatAuditOutput({ ...envelope, count: undefined as never }, "markdown");
    expect(out).not.toContain("**Count**");
  });

  it("omits the ignored-by-baseline bullet when ignoredCount is zero", () => {
    const out = formatAuditOutput({ ...envelope, ignoredCount: 0 }, "markdown");
    expect(out).not.toContain("**Ignored by baseline**");
  });

  it("skips null / object-valued envelope fields in the bullet loop", () => {
    const out = formatAuditOutput({ ...envelope, nothing: null, nested: { a: 1 } }, "markdown");
    expect(out).not.toContain("**nothing**");
    expect(out).not.toContain("**nested**");
  });

  it("titles a command with no `audit.` prefix verbatim", () => {
    const out = formatAuditOutput({ ...envelope, command: "custom_report" }, "markdown");
    expect(out).toContain("# custom report");
  });
});

describe("formatAuditOutput — markdown tableability heuristics", () => {
  it("renders a table when arrays in rows are short (≤3 scalars)", () => {
    const out = formatAuditOutput(
      { ...envelope, data: [{ itemId: "a", tags: ["x", "y"] }] },
      "markdown"
    );
    expect(out).toMatch(/\| itemId \| tags \|/);
    expect(out).toContain("x; y");
  });

  it("falls back to fenced JSON when a row array exceeds 3 entries", () => {
    const out = formatAuditOutput(
      { ...envelope, data: [{ itemId: "a", tags: ["1", "2", "3", "4"] }] },
      "markdown"
    );
    expect(out).toContain("```json");
  });

  it("escapes pipe characters and newlines in a markdown table cell", () => {
    const out = formatAuditOutput({ ...envelope, data: [{ note: "a|b\nc" }] }, "markdown");
    expect(out).toContain("a\\|b c");
  });

  it("renders an array-of-objects cell as JSON joined by semicolons", () => {
    const out = formatAuditOutput({ ...envelope, data: [{ refs: [{ id: 1 }] }] }, "markdown");
    expect(out).toContain('{"id":1}');
  });
});

describe("formatAuditOutput — markdown audit.all variants", () => {
  const baseAll = {
    command: "audit.all",
    environment: "sandbox",
    data: [],
    audits: {},
  };

  it("renders the plural failed-audits line for >1 failure", () => {
    const out = formatAuditOutput(
      {
        ...baseAll,
        counts: { auditsRun: 3, auditsFailed: 2, totalFindings: 0 },
        audits: {
          a: { findings: [], error: "boom" },
          b: { findings: [], error: "bang" },
        },
      },
      "markdown"
    );
    expect(out).toContain("**2 audits failed**");
  });

  it("renders the singular failed-audit line for exactly 1 failure", () => {
    const out = formatAuditOutput(
      {
        ...baseAll,
        counts: { auditsRun: 1, auditsFailed: 1, totalFindings: 0 },
        audits: { a: { findings: [], error: "boom" } },
      },
      "markdown"
    );
    expect(out).toContain("**1 audit failed**");
  });

  it("omits the breakdown table when there are no audits at all", () => {
    const out = formatAuditOutput(
      { ...baseAll, counts: { auditsRun: 0, totalFindings: 0 } },
      "markdown"
    );
    expect(out).not.toContain("## Breakdown");
  });

  it("includes an envelope summary line in the callout when present", () => {
    const out = formatAuditOutput({ ...baseAll, summary: "all clear", counts: {} }, "markdown");
    expect(out).toContain("> - all clear");
  });

  it("sorts the per-audit sections by descending finding count", () => {
    const out = formatAuditOutput(
      {
        ...baseAll,
        counts: { auditsRun: 2, totalFindings: 3 },
        audits: {
          small: { findings: [{ itemId: "s1" }] },
          big: { findings: [{ itemId: "b1" }, { itemId: "b2" }] },
        },
      },
      "markdown"
    );
    expect(out.indexOf("## big")).toBeLessThan(out.indexOf("## small"));
  });

  it("renders nested-row audit findings as fenced JSON inside a section", () => {
    const out = formatAuditOutput(
      {
        ...baseAll,
        counts: { auditsRun: 1, totalFindings: 1 },
        audits: { x: { findings: [{ itemId: "a", nested: { deep: 1 } }] } },
      },
      "markdown"
    );
    expect(out).toContain("## x");
    expect(out).toContain("```json");
  });

  it("omits the totalIgnored callout line when it is zero", () => {
    const out = formatAuditOutput(
      { ...baseAll, counts: { auditsRun: 1, totalFindings: 0, totalIgnored: 0 } },
      "markdown"
    );
    expect(out).not.toContain("Ignored by baseline");
  });
});
