import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFieldCache,
  isAuditCacheEnabled,
  wrapFieldsBatchWithCache,
} from "../../../src/hygiene/cache";
import type { ItemField } from "../../../src/hygiene/api/client";

let cacheDir: string;

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-cache-test-"));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  delete process.env.SITECOREAI_AUDIT_CACHE;
});

const fields = (suffix: string): ItemField[] => [
  { fieldId: "f1", name: "Title", value: `Hello ${suffix}` },
];

describe("FieldCache — get/set semantics", () => {
  it("returns null on miss", () => {
    const cache = createFieldCache({ envName: "test", cacheDir });
    expect(cache.get("missing", "2026-01-01")).toBeNull();
    expect(cache.stats().misses).toBe(1);
  });

  it("returns cached fields on hit when updatedDate matches", () => {
    const cache = createFieldCache({ envName: "test", cacheDir });
    cache.set("item-a", "2026-01-01T00:00:00Z", fields("a"));
    expect(cache.get("item-a", "2026-01-01T00:00:00Z")).toEqual(fields("a"));
    expect(cache.stats().hits).toBe(1);
  });

  it("returns null and evicts the entry when updatedDate is stale", () => {
    const cache = createFieldCache({ envName: "test", cacheDir });
    cache.set("item-a", "2026-01-01T00:00:00Z", fields("old"));
    expect(cache.get("item-a", "2026-02-01T00:00:00Z")).toBeNull();
    expect(cache.get("item-a", "2026-01-01T00:00:00Z")).toBeNull(); // already evicted
  });

  it("treats null/undefined updatedDate as a miss (no key)", () => {
    const cache = createFieldCache({ envName: "test", cacheDir });
    cache.set("item-a", null, fields("a"));
    cache.set("item-a", undefined, fields("a"));
    expect(cache.get("item-a", null)).toBeNull();
    expect(cache.get("item-a", "2026-01-01")).toBeNull();
  });
});

describe("FieldCache — persistence", () => {
  it("flushes to disk under envName + reloads on next instantiation", async () => {
    const a = createFieldCache({ envName: "sandbox", cacheDir });
    a.set("item-a", "2026-01-01T00:00:00Z", fields("a"));
    await a.flush();

    const file = path.join(cacheDir, "sandbox.json");
    expect(fs.existsSync(file)).toBe(true);

    const b = createFieldCache({ envName: "sandbox", cacheDir });
    expect(b.get("item-a", "2026-01-01T00:00:00Z")).toEqual(fields("a"));
  });

  it("uses per-env files so two envs don't share data", async () => {
    const a = createFieldCache({ envName: "envA", cacheDir });
    a.set("item-a", "2026-01-01", fields("a"));
    await a.flush();
    const b = createFieldCache({ envName: "envB", cacheDir });
    expect(b.get("item-a", "2026-01-01")).toBeNull();
  });

  it("starts fresh when the file is corrupted", async () => {
    const file = path.join(cacheDir, "broken.json");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, "{not-json", "utf8");
    const cache = createFieldCache({ envName: "broken", cacheDir });
    expect(cache.stats().size).toBe(0);
    cache.set("item-a", "2026-01-01", fields("a"));
    expect(cache.get("item-a", "2026-01-01")).toEqual(fields("a"));
  });
});

describe("FieldCache — LRU eviction", () => {
  it("evicts oldest entries when maxEntries is exceeded", () => {
    const cache = createFieldCache({ envName: "test", cacheDir, maxEntries: 2 });
    cache.set("a", "2026-01-01", fields("a"));
    cache.set("b", "2026-01-01", fields("b"));
    cache.set("c", "2026-01-01", fields("c")); // evicts oldest
    // 'a' should be gone (it was the oldest by insertion order)
    expect(cache.get("a", "2026-01-01")).toBeNull();
    expect(cache.get("b", "2026-01-01")).toEqual(fields("b"));
    expect(cache.get("c", "2026-01-01")).toEqual(fields("c"));
  });
});

describe("wrapFieldsBatchWithCache", () => {
  it("hits cache for known items, defers to underlying for misses", async () => {
    const cache = createFieldCache({ envName: "test", cacheDir });
    cache.set("cached", "2026-01-01", fields("cached"));
    const calls: string[][] = [];
    const underlying = async (ids: readonly string[]) => {
      calls.push([...ids]);
      const m = new Map<string, ItemField[]>();
      for (const id of ids) m.set(id, fields(id));
      return m;
    };
    const updated = new Map<string, string | null>([
      ["cached", "2026-01-01"],
      ["fresh", "2026-01-01"],
    ]);
    const wrapped = wrapFieldsBatchWithCache(underlying, cache, updated);
    const result = await wrapped(["cached", "fresh"]);
    // Only 'fresh' should have hit the underlying fn.
    expect(calls).toEqual([["fresh"]]);
    expect(result.get("cached")).toEqual(fields("cached"));
    expect(result.get("fresh")).toEqual(fields("fresh"));
    // And 'fresh' is now in the cache.
    expect(cache.get("fresh", "2026-01-01")).toEqual(fields("fresh"));
  });

  it("makes zero round trips when every id is cached", async () => {
    const cache = createFieldCache({ envName: "test", cacheDir });
    cache.set("a", "2026-01-01", fields("a"));
    cache.set("b", "2026-01-01", fields("b"));
    const underlying = async (): Promise<Map<string, ItemField[] | null>> => {
      throw new Error("should not be called");
    };
    const updated = new Map([
      ["a", "2026-01-01"],
      ["b", "2026-01-01"],
    ]);
    const wrapped = wrapFieldsBatchWithCache(underlying, cache, updated);
    const result = await wrapped(["a", "b"]);
    expect(result.size).toBe(2);
  });
});

describe("isAuditCacheEnabled", () => {
  it("returns false when env is unset", () => {
    delete process.env.SITECOREAI_AUDIT_CACHE;
    expect(isAuditCacheEnabled()).toBe(false);
  });

  it("returns true for truthy values", () => {
    process.env.SITECOREAI_AUDIT_CACHE = "true";
    expect(isAuditCacheEnabled()).toBe(true);
    process.env.SITECOREAI_AUDIT_CACHE = "1";
    expect(isAuditCacheEnabled()).toBe(true);
    process.env.SITECOREAI_AUDIT_CACHE = "ON";
    expect(isAuditCacheEnabled()).toBe(true);
  });

  it("returns false for falsy values", () => {
    process.env.SITECOREAI_AUDIT_CACHE = "false";
    expect(isAuditCacheEnabled()).toBe(false);
    process.env.SITECOREAI_AUDIT_CACHE = "0";
    expect(isAuditCacheEnabled()).toBe(false);
  });
});
