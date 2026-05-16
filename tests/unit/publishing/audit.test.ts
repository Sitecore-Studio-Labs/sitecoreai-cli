import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readRecentPublishAudit,
  recordPublishAudit,
  type PublishAuditEntry,
} from "../../../src/publishing/audit";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-audit-"));
const auditPath = path.join(tmpRoot, "audit.log");

const previousEnv = process.env.SITECOREAI_AUDIT_LOG;

const sampleEntry = (overrides: Partial<PublishAuditEntry> = {}): PublishAuditEntry => ({
  ts: "2026-05-14T10:00:00.000Z",
  command: "publish item",
  caller: { type: "human", via: "cli" },
  scope: {
    envName: "sandbox",
    target: "Edge",
    kind: "item",
    itemIds: ["00000000-0000-0000-0000-000000000001"],
    languages: ["en-US"],
  },
  risk: "normal",
  scopeHash: "abc123",
  outcome: "ok",
  jobId: "job_1",
  ...overrides,
});

beforeEach(() => {
  process.env.SITECOREAI_AUDIT_LOG = auditPath;
  if (fs.existsSync(auditPath)) {
    fs.unlinkSync(auditPath);
  }
});

afterEach(() => {
  if (previousEnv === undefined) {
    delete process.env.SITECOREAI_AUDIT_LOG;
  } else {
    process.env.SITECOREAI_AUDIT_LOG = previousEnv;
  }
});

describe("recordPublishAudit", () => {
  it("writes a JSON-line and creates the directory if missing", () => {
    recordPublishAudit(sampleEntry());
    expect(fs.existsSync(auditPath)).toBe(true);
    const lines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as PublishAuditEntry;
    expect(parsed.command).toBe("publish item");
    expect(parsed.outcome).toBe("ok");
  });

  it("appends rather than overwriting", () => {
    recordPublishAudit(sampleEntry({ jobId: "j1" }));
    recordPublishAudit(sampleEntry({ jobId: "j2" }));
    const lines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]) as PublishAuditEntry).jobId).toBe("j1");
    expect((JSON.parse(lines[1]) as PublishAuditEntry).jobId).toBe("j2");
  });

  it("honors SITECOREAI_AUDIT_LOG override", () => {
    const customPath = path.join(tmpRoot, "custom.log");
    process.env.SITECOREAI_AUDIT_LOG = customPath;
    recordPublishAudit(sampleEntry());
    expect(fs.existsSync(customPath)).toBe(true);
    fs.unlinkSync(customPath);
  });
});

describe("readRecentPublishAudit", () => {
  it("returns an empty array when the log doesn't exist", () => {
    expect(readRecentPublishAudit()).toEqual([]);
  });

  it("returns most recent entries first-in-order, capped by limit", () => {
    for (let i = 1; i <= 10; i += 1) {
      recordPublishAudit(sampleEntry({ jobId: `j${i}` }));
    }
    const recent = readRecentPublishAudit(3);
    expect(recent.map((e) => e.jobId)).toEqual(["j8", "j9", "j10"]);
  });

  it("skips malformed lines without throwing", () => {
    fs.writeFileSync(
      auditPath,
      [
        JSON.stringify(sampleEntry({ jobId: "ok-1" })),
        "{not json",
        JSON.stringify(sampleEntry({ jobId: "ok-2" })),
        "",
      ].join("\n") + "\n",
      "utf8"
    );
    const recent = readRecentPublishAudit();
    expect(recent.map((e) => e.jobId)).toEqual(["ok-1", "ok-2"]);
  });
});
