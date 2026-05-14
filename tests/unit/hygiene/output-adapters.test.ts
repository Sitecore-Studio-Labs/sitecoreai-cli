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
});
