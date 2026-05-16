import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPublishHistory } from "../../../src/publishing/tasks/history";
import type { PublishAuditEntry } from "../../../src/publishing/audit";

const mkTempAuditFile = (entries: PublishAuditEntry[]): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-history-test-"));
  const file = path.join(dir, "audit.log");
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return file;
};

const entry = (overrides: Partial<PublishAuditEntry>): PublishAuditEntry => ({
  ts: "2026-05-14T22:00:00Z",
  command: "publish item",
  caller: { type: "human", via: "cli" },
  scope: {
    envName: "sandbox",
    target: "Edge",
    kind: "item",
  },
  risk: "normal",
  scopeHash: "abc",
  outcome: "ok",
  jobId: "job_test",
  ...overrides,
});

describe("runPublishHistory", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    delete process.env.SITECOREAI_AUDIT_LOG;
  });

  it("emits JSONL when --json is set and prints filtered entries", async () => {
    const file = mkTempAuditFile([
      entry({ ts: "2026-05-13T00:00:00Z" }),
      entry({
        ts: "2026-05-14T22:00:00Z",
        command: "publish all",
        scope: { envName: "prod", target: "Edge", kind: "full" },
      }),
      entry({ ts: "2026-05-14T23:00:00Z", outcome: "error", errorCode: "NETWORK" }),
    ]);
    process.env.SITECOREAI_AUDIT_LOG = file;
    await runPublishHistory({ json: true, outcome: "error" });

    const lines = stdoutChunks.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.outcome).toBe("error");
    expect(parsed.errorCode).toBe("NETWORK");
  });

  it("--env filters by scope.envName", async () => {
    const file = mkTempAuditFile([
      entry({ scope: { envName: "sandbox", target: "Edge", kind: "item" } }),
      entry({ scope: { envName: "prod", target: "Edge", kind: "full" } }),
    ]);
    process.env.SITECOREAI_AUDIT_LOG = file;
    await runPublishHistory({ json: true, env: "prod" });
    const lines = stdoutChunks.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).scope.envName).toBe("prod");
  });

  it("--command does substring match", async () => {
    const file = mkTempAuditFile([
      entry({ command: "publish item" }),
      entry({ command: "publish all" }),
      entry({ command: "publish unpublish" }),
    ]);
    process.env.SITECOREAI_AUDIT_LOG = file;
    await runPublishHistory({ json: true, command: "unpublish" });
    const lines = stdoutChunks.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).command).toBe("publish unpublish");
  });

  it("--since accepts relative specs like '24h'", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1h ago
    const old = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    const file = mkTempAuditFile([
      entry({ ts: old, command: "publish item" }),
      entry({ ts: recent, command: "publish all" }),
    ]);
    process.env.SITECOREAI_AUDIT_LOG = file;
    await runPublishHistory({ json: true, since: "24h" });
    const lines = stdoutChunks.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).command).toBe("publish all");
  });

  it("--since rejects malformed specs", async () => {
    await expect(runPublishHistory({ since: "not-a-date" })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("returns no-entries message when audit file is absent", async () => {
    process.env.SITECOREAI_AUDIT_LOG = "/tmp/scai-history-test-nonexistent.log";
    await expect(runPublishHistory({ json: true })).resolves.not.toThrow();
    expect(stdoutChunks.join("")).toBe("");
  });
});
