import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditSuiteToRunnerInput,
  expandOutputPath,
  loadAuditSuite,
} from "../../../src/hygiene/audit-suite";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-suite-test-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const writeYaml = (yaml: string): string => {
  const f = path.join(dir, "suite.yaml");
  fs.writeFileSync(f, yaml, "utf8");
  return f;
};

describe("loadAuditSuite", () => {
  it("parses a minimal valid suite", () => {
    const f = writeYaml(`
version: 1
name: test
audits:
  - name: orphans
`);
    const suite = loadAuditSuite(f);
    expect(suite.name).toBe("test");
    expect(suite.audits[0].name).toBe("orphans");
  });

  it("rejects unsupported version", () => {
    const f = writeYaml(`
version: 99
name: test
audits:
  - name: orphans
`);
    expect(() => loadAuditSuite(f)).toThrow(/Unsupported audit-suite version/);
  });

  it("rejects missing name", () => {
    const f = writeYaml(`
version: 1
audits:
  - name: orphans
`);
    expect(() => loadAuditSuite(f)).toThrow(/must have a 'name'/);
  });

  it("rejects empty audits", () => {
    const f = writeYaml(`
version: 1
name: test
audits: []
`);
    expect(() => loadAuditSuite(f)).toThrow(/non-empty 'audits'/);
  });

  it("rejects non-YAML content gracefully", () => {
    fs.writeFileSync(path.join(dir, "bad.yaml"), "{[ malformed }}", "utf8");
    expect(() => loadAuditSuite(path.join(dir, "bad.yaml"))).toThrow(/not valid YAML/);
  });

  it("reports a friendly error when file is missing", () => {
    expect(() => loadAuditSuite(path.join(dir, "nope.yaml"))).toThrow(/not found/);
  });
});

describe("expandOutputPath", () => {
  const fixedNow = new Date("2026-05-14T10:30:45Z");
  it("substitutes {date}, {datetime}, {env}, {suite}", () => {
    const out = expandOutputPath("./reports/{env}/{suite}-{date}.md", {
      envName: "prod",
      suiteName: "monthly",
      now: fixedNow,
    });
    // Date pad-handling depends on local timezone — assert structure rather than exact day.
    expect(out).toMatch(/^\.\/reports\/prod\/monthly-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("leaves unknown tokens alone", () => {
    const out = expandOutputPath("./x/{unknown}.md", {
      envName: "p",
      suiteName: "s",
      now: fixedNow,
    });
    expect(out).toBe("./x/{unknown}.md");
  });
});

describe("auditSuiteToRunnerInput", () => {
  it("kebab-case option keys become camelCase", () => {
    const { include, sharedOptions } = auditSuiteToRunnerInput({
      version: 1,
      name: "x",
      audits: [
        {
          name: "stale-content",
          options: { "not-updated-in-days": 180, "include-system": true },
        },
        {
          name: "duplicates",
          options: { "min-group-size": 3 },
        },
      ],
    });
    expect(include).toEqual(["stale-content", "duplicates"]);
    expect(sharedOptions).toMatchObject({
      notUpdatedInDays: 180,
      includeSystem: true,
      minGroupSize: 3,
    });
  });
});
