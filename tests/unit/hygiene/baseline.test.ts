import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprintFinding, openBaseline, splitByBaseline } from "../../../src/hygiene/baseline";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-baseline-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("fingerprintFinding", () => {
  it("excludes day-since on stale-workflow so same item stays ignored across runs", () => {
    const a = fingerprintFinding("stale-workflow", {
      itemId: "abc",
      stateName: "Draft",
      daysSinceUpdate: 30,
    });
    const b = fingerprintFinding("stale-workflow", {
      itemId: "abc",
      stateName: "Draft",
      daysSinceUpdate: 60,
    });
    expect(a).toBe(b);
  });

  it("flips when the identifying fields differ", () => {
    const a = fingerprintFinding("broken-links", {
      itemId: "abc",
      brokenRefs: [{ fieldName: "Link", refItemId: "ref1" }],
    });
    const b = fingerprintFinding("broken-links", {
      itemId: "abc",
      brokenRefs: [{ fieldName: "Link", refItemId: "ref2" }],
    });
    expect(a).not.toBe(b);
  });

  it("duplicates fingerprint is the contentHash alone", () => {
    const a = fingerprintFinding("duplicates", { contentHash: "xyz", members: [{ itemId: "a" }] });
    const b = fingerprintFinding("duplicates", { contentHash: "xyz", members: [{ itemId: "z" }] });
    expect(a).toBe(b);
  });

  it("unknown audits fall back to JSON hash", () => {
    const a = fingerprintFinding("future-audit", { foo: 1 });
    const b = fingerprintFinding("future-audit", { foo: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("openBaseline — get/add/remove", () => {
  it("reports a finding as not-ignored before it is added", () => {
    const b = openBaseline({ envName: "test", configDir: dir });
    expect(b.isIgnored("broken-links", { itemId: "a", brokenRefs: [] })).toBe(false);
  });

  it("isIgnored returns true after add", () => {
    const b = openBaseline({ envName: "test", configDir: dir });
    const finding = { itemId: "a", brokenRefs: [{ fieldName: "F", refItemId: "r" }] };
    b.add("broken-links", finding);
    expect(b.isIgnored("broken-links", finding)).toBe(true);
  });

  it("add is idempotent", () => {
    const b = openBaseline({ envName: "test", configDir: dir });
    const finding = { itemId: "a", brokenRefs: [{ fieldName: "F", refItemId: "r" }] };
    b.add("broken-links", finding);
    b.add("broken-links", finding);
    expect(b.snapshot().ignored["broken-links"]).toHaveLength(1);
  });

  it("remove drops the entry; subsequent isIgnored is false", () => {
    const b = openBaseline({ envName: "test", configDir: dir });
    const finding = { itemId: "a", brokenRefs: [{ fieldName: "F", refItemId: "r" }] };
    b.add("broken-links", finding);
    const fp = fingerprintFinding("broken-links", finding);
    b.remove("broken-links", fp);
    expect(b.isIgnored("broken-links", finding)).toBe(false);
  });
});

describe("openBaseline — persistence", () => {
  it("survives a flush/reload round trip", async () => {
    const b1 = openBaseline({ envName: "sandbox", configDir: dir });
    b1.add("orphans", { archivalId: "arch-1" }, "test note");
    await b1.flush();
    const filePath = path.join(dir, ".scai", "audit-baseline-sandbox.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const b2 = openBaseline({ envName: "sandbox", configDir: dir });
    expect(b2.isIgnored("orphans", { archivalId: "arch-1" })).toBe(true);
  });

  it("uses per-env files (different envName → different file)", async () => {
    const a = openBaseline({ envName: "envA", configDir: dir });
    a.add("orphans", { archivalId: "x" });
    await a.flush();
    const b = openBaseline({ envName: "envB", configDir: dir });
    expect(b.isIgnored("orphans", { archivalId: "x" })).toBe(false);
  });
});

describe("splitByBaseline", () => {
  it("partitions findings into kept + ignored", () => {
    const b = openBaseline({ envName: "test", configDir: dir });
    b.add("duplicates", { contentHash: "abc" });
    const split = splitByBaseline(
      "duplicates",
      [{ contentHash: "abc" }, { contentHash: "xyz" }],
      b
    );
    expect(split.kept).toHaveLength(1);
    expect(split.ignored).toHaveLength(1);
    expect((split.kept[0] as { contentHash: string }).contentHash).toBe("xyz");
  });
});
