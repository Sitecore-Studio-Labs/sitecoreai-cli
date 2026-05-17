/**
 * `scai hygiene audit baseline <show|remove|reset|create>` task runners.
 *
 * The accept verb is covered by `audit-baseline-accept.test.ts`; this
 * file tops up coverage of the other verbs. `resolveEnvironment` is
 * mocked; the baseline library + filesystem are real (tmpdir-scoped),
 * so `openBaseline`/`add`/`remove`/`flush` round-trip for real.
 *
 * `runBaselineCreate` delegates to `runAuditAll`, which we mock so the
 * test stays a pure unit test (no tenant, no network).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn().mockReturnValue({
    envName: "sandbox",
    environment: {},
    root: {},
    timeoutMs: undefined,
  }),
}));

const runAuditAllMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../../src/hygiene/tasks/audit/all", () => ({
  runAuditAll: runAuditAllMock,
  auditNames: () => ["broken-links", "unused-media"],
}));

import {
  runBaselineCreate,
  runBaselineRemove,
  runBaselineReset,
  runBaselineShow,
} from "../../../../src/hygiene/tasks/audit/baseline";
import { openBaseline } from "../../../../src/hygiene/baseline";

let configDir: string;

/** Seed the baseline file with the given findings, returns fingerprints. */
const seed = (audit: string, findings: unknown[]): string[] => {
  const baseline = openBaseline({ envName: "sandbox", configDir });
  for (const f of findings) baseline.add(audit, f);
  baseline.flush();
  return openBaseline({ envName: "sandbox", configDir })
    .snapshot()
    .ignored[audit].map((e) => e.fingerprint);
};

const captureStdout = (): string[] => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  return writes;
};

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-baseline-"));
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("runBaselineShow", () => {
  it("reports zero entries for a fresh (non-existent) baseline as JSON", async () => {
    const writes = captureStdout();
    await runBaselineShow({ config: configDir, json: true });
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.baseline.show");
    expect(parsed.totalEntries).toBe(0);
    expect(parsed.ignored).toEqual({});
  });

  it("reports the seeded entries and a per-audit count", async () => {
    seed("broken-links", [{ itemId: "a" }, { itemId: "b" }]);
    const writes = captureStdout();
    await runBaselineShow({ config: configDir, json: true });
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.totalEntries).toBe(2);
    expect(parsed.ignored["broken-links"]).toHaveLength(2);
  });
});

describe("runBaselineRemove", () => {
  it("rejects when --audit is missing", async () => {
    await expect(
      runBaselineRemove({ config: configDir, fingerprint: "abc" } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects when --fingerprint is missing", async () => {
    await expect(
      runBaselineRemove({ config: configDir, audit: "broken-links" } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("removes a single entry by fingerprint and persists the change", async () => {
    const [fp1] = seed("broken-links", [{ itemId: "a" }, { itemId: "b" }]);
    await runBaselineRemove({ config: configDir, audit: "broken-links", fingerprint: fp1 });
    const snap = openBaseline({ envName: "sandbox", configDir }).snapshot();
    expect(snap.ignored["broken-links"]).toHaveLength(1);
    expect(snap.ignored["broken-links"][0].fingerprint).not.toBe(fp1);
  });
});

describe("runBaselineReset", () => {
  it("clears every entry for a single named audit only", async () => {
    seed("broken-links", [{ itemId: "a" }, { itemId: "b" }]);
    seed("unused-media", [{ itemId: "m" }]);
    await runBaselineReset({ config: configDir, audit: "broken-links" });
    const snap = openBaseline({ envName: "sandbox", configDir }).snapshot();
    expect(snap.ignored["broken-links"] ?? []).toHaveLength(0);
    expect(snap.ignored["unused-media"]).toHaveLength(1);
  });

  it("clears every audit when --audit is omitted", async () => {
    seed("broken-links", [{ itemId: "a" }]);
    seed("unused-media", [{ itemId: "m" }]);
    await runBaselineReset({ config: configDir });
    const snap = openBaseline({ envName: "sandbox", configDir }).snapshot();
    const total = Object.values(snap.ignored).reduce((n, l) => n + l.length, 0);
    expect(total).toBe(0);
  });
});

describe("runBaselineCreate", () => {
  it("delegates to runAuditAll with updateBaseline + the requested audits", async () => {
    await runBaselineCreate({ config: configDir, audits: ["broken-links"], json: true } as never);
    expect(runAuditAllMock).toHaveBeenCalledTimes(1);
    const opts = runAuditAllMock.mock.calls[0][0] as {
      include?: string[];
      updateBaseline?: boolean;
      quiet?: boolean;
    };
    expect(opts.include).toEqual(["broken-links"]);
    expect(opts.updateBaseline).toBe(true);
    expect(opts.quiet).toBe(true);
  });

  it("still delegates to runAuditAll(updateBaseline) when --reset is set", async () => {
    seed("broken-links", [{ itemId: "a" }, { itemId: "b" }]);
    await runBaselineCreate({
      config: configDir,
      audits: ["broken-links"],
      reset: true,
      json: true,
    } as never);
    // The reset path mutates an in-memory baseline handle and relies on
    // the (real) runAuditAll to re-add + flush the refreshed findings;
    // we can only assert the delegation here, not the on-disk wipe.
    expect(runAuditAllMock).toHaveBeenCalledTimes(1);
    const opts = runAuditAllMock.mock.calls[0][0] as { updateBaseline?: boolean };
    expect(opts.updateBaseline).toBe(true);
  });
});
