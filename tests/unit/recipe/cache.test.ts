import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cachedSkipFor,
  hashIr,
  hashRoots,
  loadRecipeCache,
  recordCacheEntry,
  saveRecipeCache,
} from "../../../src/recipe/runtime/cache";
import type { OperationIr } from "../../../src/recipe/ir/operations";

const exampleIr: OperationIr = {
  schemaVersion: "1",
  recipeHandle: "cta-button@1",
  operations: [],
};

describe("recipe cache — hashes", () => {
  it("hashIr is deterministic for the same IR shape", () => {
    expect(hashIr(exampleIr)).toBe(hashIr({ ...exampleIr }));
  });

  it("hashIr changes when the IR changes (even subtly)", () => {
    const a = hashIr(exampleIr);
    const b = hashIr({ ...exampleIr, recipeHandle: "cta-button@2" });
    expect(a).not.toBe(b);
  });

  it("hashRoots ignores key ordering and undefined entries", () => {
    const a = hashRoots({
      templatesRoot: "/t",
      renderingsRoot: "/r",
      contentItemsRoot: undefined,
    });
    const b = hashRoots({
      renderingsRoot: "/r",
      templatesRoot: "/t",
    });
    expect(a).toBe(b);
  });

  it("hashRoots changes when a root path changes", () => {
    const a = hashRoots({ templatesRoot: "/t" });
    const b = hashRoots({ templatesRoot: "/t2" });
    expect(a).not.toBe(b);
  });
});

describe("recipe cache — load/save round-trip", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-cache-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty cache when no file exists", async () => {
    const cache = await loadRecipeCache(tmpDir);
    expect(cache.schemaVersion).toBe("1");
    expect(cache.tenants).toEqual({});
  });

  it("persists and reloads cache entries verbatim", async () => {
    const cache = await loadRecipeCache(tmpDir);
    recordCacheEntry(cache, "sandbox", "roots-hash-1", "cta-button@1", {
      irHash: "ir-hash-1",
      lastApplied: "2026-05-05T00:00:00.000Z",
      summary: { create: 5, update: 0, skip: 12 },
    });
    await saveRecipeCache(tmpDir, cache);

    const reloaded = await loadRecipeCache(tmpDir);
    expect(reloaded.tenants.sandbox.recipes["cta-button@1"]).toMatchObject({
      irHash: "ir-hash-1",
      summary: { create: 5, update: 0, skip: 12 },
    });
  });

  it("invalidates all entries for a tenant when rootsHash changes", () => {
    const cache = {
      schemaVersion: "1" as const,
      tenants: {
        sandbox: {
          rootsHash: "old-hash",
          recipes: {
            "a@1": {
              irHash: "ir-a",
              lastApplied: "x",
              summary: { create: 0, update: 0, skip: 0 },
            },
          },
        },
      },
    };
    recordCacheEntry(cache, "sandbox", "new-hash", "b@1", {
      irHash: "ir-b",
      lastApplied: "y",
      summary: { create: 0, update: 0, skip: 0 },
    });
    expect(cache.tenants.sandbox.rootsHash).toBe("new-hash");
    // Entries from the old rootsHash got dropped — only the freshly-recorded
    // one remains.
    expect(cache.tenants.sandbox.recipes).toEqual({
      "b@1": expect.any(Object),
    });
  });
});

describe("recipe cache — cachedSkipFor", () => {
  const baseCache = {
    schemaVersion: "1" as const,
    tenants: {
      sandbox: {
        rootsHash: "roots-hash-1",
        recipes: {
          "cta-button@1": {
            irHash: "ir-hash-1",
            lastApplied: "2026-05-05T00:00:00.000Z",
            summary: { create: 5, update: 0, skip: 12 },
          },
        },
      },
    },
  };

  it("returns the entry on a full match", () => {
    const entry = cachedSkipFor(baseCache, "sandbox", "roots-hash-1", "cta-button@1", "ir-hash-1");
    expect(entry?.irHash).toBe("ir-hash-1");
  });

  it("returns null when irHash differs", () => {
    expect(
      cachedSkipFor(baseCache, "sandbox", "roots-hash-1", "cta-button@1", "different-hash")
    ).toBeNull();
  });

  it("returns null when rootsHash differs", () => {
    expect(
      cachedSkipFor(baseCache, "sandbox", "different-roots", "cta-button@1", "ir-hash-1")
    ).toBeNull();
  });

  it("returns null when the recipe handle is not in the cache", () => {
    expect(
      cachedSkipFor(baseCache, "sandbox", "roots-hash-1", "unknown@1", "ir-hash-1")
    ).toBeNull();
  });

  it("returns null when the tenant is not in the cache", () => {
    expect(
      cachedSkipFor(baseCache, "different-env", "roots-hash-1", "cta-button@1", "ir-hash-1")
    ).toBeNull();
  });
});
