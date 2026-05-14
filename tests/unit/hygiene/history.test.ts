import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureHistory,
  diffSnapshots,
  listHistory,
  loadSnapshot,
} from "../../../src/hygiene/history";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-history-test-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const envelope = (audits: Record<string, Array<Record<string, unknown>>>) => ({
  audits: Object.fromEntries(
    Object.entries(audits).map(([name, findings]) => [name, { findings }])
  ),
});

describe("captureHistory + loadSnapshot", () => {
  it("persists per-audit fingerprints + samples", () => {
    const file = captureHistory({
      envName: "test",
      configDir: dir,
      envelope: envelope({
        "broken-links": [
          { itemId: "a", path: "/x/a", brokenRefs: [{ fieldName: "F", refItemId: "r" }] },
        ],
        orphans: [{ archivalId: "arch-1", name: "X" }],
      }),
    });
    expect(fs.existsSync(file)).toBe(true);
    const snap = loadSnapshot(file);
    expect(snap.envName).toBe("test");
    expect(snap.audits["broken-links"]).toHaveLength(1);
    expect(snap.audits.orphans[0].sample?.archivalId).toBe("arch-1");
  });

  it("listHistory returns newest first", async () => {
    captureHistory({
      envName: "test",
      configDir: dir,
      envelope: envelope({ orphans: [] }),
      now: new Date("2025-01-01T00:00:00Z"),
    });
    // Force a different mtime by sleeping a few ms.
    await new Promise((r) => setTimeout(r, 50));
    captureHistory({
      envName: "test",
      configDir: dir,
      envelope: envelope({ orphans: [] }),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const list = listHistory({ envName: "test", configDir: dir });
    expect(list).toHaveLength(2);
    expect(list[0].capturedAt > list[1].capturedAt).toBe(true);
  });
});

describe("diffSnapshots", () => {
  it("reports added + removed per audit", () => {
    const f1 = captureHistory({
      envName: "test",
      configDir: dir,
      envelope: envelope({
        orphans: [
          { archivalId: "a", name: "A" },
          { archivalId: "b", name: "B" },
        ],
      }),
      now: new Date("2025-01-01T00:00:00Z"),
    });
    const f2 = captureHistory({
      envName: "test",
      configDir: dir,
      envelope: envelope({
        orphans: [
          { archivalId: "b", name: "B" },
          { archivalId: "c", name: "C" },
        ],
      }),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const diff = diffSnapshots(loadSnapshot(f1), loadSnapshot(f2));
    expect(diff.perAudit.orphans.total.from).toBe(2);
    expect(diff.perAudit.orphans.total.to).toBe(2);
    expect(diff.perAudit.orphans.added).toHaveLength(1);
    expect(diff.perAudit.orphans.added[0].sample?.archivalId).toBe("c");
    expect(diff.perAudit.orphans.removed).toHaveLength(1);
    expect(diff.perAudit.orphans.removed[0].sample?.archivalId).toBe("a");
  });

  it("totals add + removed across audits", () => {
    const f1 = captureHistory({
      envName: "test",
      configDir: dir,
      envelope: envelope({ orphans: [{ archivalId: "a" }], duplicates: [{ contentHash: "x" }] }),
      now: new Date("2025-01-01T00:00:00Z"),
    });
    const f2 = captureHistory({
      envName: "test",
      configDir: dir,
      envelope: envelope({
        orphans: [{ archivalId: "a" }, { archivalId: "b" }],
        duplicates: [],
      }),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const diff = diffSnapshots(loadSnapshot(f1), loadSnapshot(f2));
    expect(diff.totals.added).toBe(1);
    expect(diff.totals.removed).toBe(1);
    expect(diff.totals.net).toBe(0);
  });
});
