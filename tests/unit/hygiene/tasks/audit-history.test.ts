/**
 * `scai hygiene audit history <capture|list|diff>` task runners.
 *
 * `runHistoryCapture` runs `audit all` into a tmp file then persists a
 * snapshot under `.scai/audit-history/<env>/`. We mock `runAuditAll`
 * to write a deterministic envelope to the tmp `--output` path, and
 * mock `resolveEnvironment`. The history library + filesystem are real
 * (tmpdir-scoped) so `captureHistory`/`listHistory`/`diffSnapshots`
 * are exercised end to end.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { consola } from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Capture text-mode logger output. `logger.info` / `logger.warn` route
 * through `consola`, not `process.stdout.write` — spy on both and return
 * the joined message text.
 */
const captureConsola = (): { lines: () => string; restore: () => void } => {
  const messages: string[] = [];
  const infoSpy = vi
    .spyOn(consola, "info")
    .mockImplementation((...args: unknown[]) => messages.push(args.map(String).join(" ")) as never);
  const warnSpy = vi
    .spyOn(consola, "warn")
    .mockImplementation((...args: unknown[]) => messages.push(args.map(String).join(" ")) as never);
  return {
    lines: () => messages.join("\n"),
    restore: () => {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
};

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn().mockReturnValue({
    envName: "sandbox",
    environment: {},
    root: {},
    timeoutMs: undefined,
  }),
}));

const runAuditAllMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/hygiene/tasks/audit/all", () => ({
  runAuditAll: runAuditAllMock,
  // `baseline.ts` imports `auditNames` from the same module; keep it
  // defined so unrelated imports don't explode.
  auditNames: () => ["broken-links"],
}));

import {
  runHistoryCapture,
  runHistoryDiff,
  runHistoryList,
} from "../../../../src/hygiene/tasks/audit/history";

let configDir: string;

const captureWritesEnvelope = (audits: Record<string, { findings?: unknown[] }>): void => {
  runAuditAllMock.mockImplementationOnce(async (options: { output: string }) => {
    fs.writeFileSync(options.output, JSON.stringify({ command: "audit.all", audits }), "utf8");
  });
};

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-audit-history-"));
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("runHistoryCapture", () => {
  it("writes a snapshot file and reports it as JSON", async () => {
    captureWritesEnvelope({
      "broken-links": { findings: [{ itemId: "a" }, { itemId: "b" }] },
    });
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    await runHistoryCapture({ config: configDir, json: true });
    vi.restoreAllMocks();

    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.history.capture");
    expect(parsed.totalFindings).toBe(2);
    expect(fs.existsSync(parsed.file)).toBe(true);
  });

  it("forwards --output (tmp) + format json + quiet to runAuditAll", async () => {
    captureWritesEnvelope({ "broken-links": { findings: [] } });
    await runHistoryCapture({ config: configDir, json: true });
    expect(runAuditAllMock).toHaveBeenCalledTimes(1);
    const opts = runAuditAllMock.mock.calls[0][0] as {
      output: string;
      format: string;
      quiet: boolean;
    };
    expect(opts.format).toBe("json");
    expect(opts.quiet).toBe(true);
    expect(opts.output).toMatch(/scai-audit-all-.*\.json$/);
  });
});

describe("runHistoryList", () => {
  it("reports no snapshots when the history dir is empty", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runHistoryList({ config: configDir, json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.history.list");
    expect(parsed.count).toBe(0);
    expect(parsed.snapshots).toEqual([]);
  });

  it("lists snapshots after a capture", async () => {
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a" }] } });
    await runHistoryCapture({ config: configDir, json: true });

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runHistoryList({ config: configDir, json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.count).toBe(1);
    expect(parsed.snapshots[0].filePath).toMatch(/\.json$/);
  });
});

describe("runHistoryDiff", () => {
  it("throws INPUT_INVALID with fewer than 2 snapshots and no explicit from/to", async () => {
    await expect(runHistoryDiff({ config: configDir, json: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("diffs the two most recent snapshots and reports per-audit deltas", async () => {
    // Snapshot 1: one finding.
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a", path: "/x/a" }] } });
    await runHistoryCapture({ config: configDir, json: true });
    // Force a distinct mtime/filename for the second snapshot.
    await new Promise((r) => setTimeout(r, 1100));
    // Snapshot 2: the original finding plus a new one.
    captureWritesEnvelope({
      "broken-links": {
        findings: [
          { itemId: "a", path: "/x/a" },
          { itemId: "b", path: "/x/b" },
        ],
      },
    });
    await runHistoryCapture({ config: configDir, json: true });

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runHistoryDiff({ config: configDir, json: true });
    vi.restoreAllMocks();

    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.history.diff");
    expect(parsed.totals.added).toBe(1);
    expect(parsed.totals.removed).toBe(0);
    expect(parsed.totals.net).toBe(1);
    expect(parsed.perAudit["broken-links"].total).toMatchObject({ from: 1, to: 2, delta: 1 });
  });
});

// ───────────────────────────────────────────────────────────────────────
// Text-mode (non-JSON) coverage — exercises the human-readable branches
// of capture / list / diff that the JSON-mode tests above skip.
// ───────────────────────────────────────────────────────────────────────

describe("runHistoryCapture — text mode", () => {
  it("reports the captured snapshot path via logger.info", async () => {
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a" }] } });
    const cap = captureConsola();
    await runHistoryCapture({ config: configDir });
    cap.restore();
    expect(cap.lines()).toContain("Captured snapshot:");
  });

  it("derives the config dir from a `.json` config path", async () => {
    captureWritesEnvelope({ "broken-links": { findings: [] } });
    const cfgFile = path.join(configDir, "sitecoreai.cli.json");
    fs.writeFileSync(cfgFile, "{}", "utf8");
    await runHistoryCapture({ config: cfgFile, json: true });
    // The snapshot dir is created alongside the config file's directory.
    expect(fs.existsSync(path.join(configDir, ".scai", "audit-history", "sandbox"))).toBe(true);
  });
});

describe("runHistoryList — text mode", () => {
  it("reports 'no snapshots' guidance when the history dir is empty", async () => {
    const cap = captureConsola();
    await runHistoryList({ config: configDir });
    cap.restore();
    expect(cap.lines()).toContain("No snapshots yet.");
  });

  it("lists a single snapshot with singular phrasing", async () => {
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a" }] } });
    await runHistoryCapture({ config: configDir, json: true });
    const cap = captureConsola();
    await runHistoryList({ config: configDir });
    cap.restore();
    expect(cap.lines()).toContain("1 snapshot:");
  });
});

describe("runHistoryDiff — text mode", () => {
  it("renders per-audit deltas and added-sample lines", async () => {
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a", path: "/x/a" }] } });
    await runHistoryCapture({ config: configDir, json: true });
    await new Promise((r) => setTimeout(r, 1100));
    captureWritesEnvelope({
      "broken-links": {
        findings: [
          { itemId: "a", path: "/x/a" },
          { itemId: "b", path: "/x/b" },
        ],
      },
    });
    await runHistoryCapture({ config: configDir, json: true });

    const cap = captureConsola();
    await runHistoryDiff({ config: configDir });
    cap.restore();
    const out = cap.lines();
    expect(out).toContain("Diff:");
    expect(out).toContain("Totals: +1 added");
    // Per-audit line with the +1 delta sign.
    expect(out).toContain("broken-links: 1 → 2 (+1)");
    // Added-sample bullet uses the finding path.
    expect(out).toContain("+ /x/b");
  });

  it("renders removed-sample lines and a negative delta when findings shrink", async () => {
    captureWritesEnvelope({
      "broken-links": {
        findings: [
          { itemId: "a", path: "/x/a" },
          { itemId: "b", path: "/x/b" },
        ],
      },
    });
    await runHistoryCapture({ config: configDir, json: true });
    await new Promise((r) => setTimeout(r, 1100));
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a", path: "/x/a" }] } });
    await runHistoryCapture({ config: configDir, json: true });

    const cap = captureConsola();
    await runHistoryDiff({ config: configDir });
    cap.restore();
    const out = cap.lines();
    expect(out).toContain("Totals: +0 added, -1 removed");
    expect(out).toContain("broken-links: 2 → 1 (-1)");
    expect(out).toContain("- /x/b");
  });

  it("renders nothing extra for a per-audit entry whose findings did not change", async () => {
    // Two identical snapshots → the per-audit added/removed lists are
    // empty, so the diff loop `continue`s past that audit's section.
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a", path: "/x/a" }] } });
    await runHistoryCapture({ config: configDir, json: true });
    await new Promise((r) => setTimeout(r, 1100));
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a", path: "/x/a" }] } });
    await runHistoryCapture({ config: configDir, json: true });

    const cap = captureConsola();
    await runHistoryDiff({ config: configDir });
    cap.restore();
    const out = cap.lines();
    expect(out).toContain("Totals: +0 added, -0 removed");
    // Unchanged audit → no `broken-links: …` per-audit line.
    expect(out).not.toContain("broken-links:");
  });

  it("falls back to process.cwd() for capture when no --config is supplied", async () => {
    captureWritesEnvelope({ "broken-links": { findings: [] } });
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(configDir);
    await runHistoryCapture({ json: true });
    cwdSpy.mockRestore();
    // The snapshot lands under the cwd-derived history dir.
    expect(fs.existsSync(path.join(configDir, ".scai", "audit-history", "sandbox"))).toBe(true);
  });

  it("honours explicit --from / --to snapshot paths", async () => {
    captureWritesEnvelope({ "broken-links": { findings: [{ itemId: "a", path: "/x/a" }] } });
    await runHistoryCapture({ config: configDir, json: true });
    await new Promise((r) => setTimeout(r, 1100));
    captureWritesEnvelope({
      "broken-links": {
        findings: [
          { itemId: "a", path: "/x/a" },
          { itemId: "b", path: "/x/b" },
        ],
      },
    });
    await runHistoryCapture({ config: configDir, json: true });

    const snapDir = path.join(configDir, ".scai", "audit-history", "sandbox");
    const files = fs
      .readdirSync(snapDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(snapDir, f))
      .sort();

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runHistoryDiff({ config: configDir, from: files[0], to: files[1], json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.fromFile).toBe(files[0]);
    expect(parsed.toFile).toBe(files[1]);
  });
});
