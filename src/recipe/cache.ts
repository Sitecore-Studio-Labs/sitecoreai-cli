/**
 * Recipe-level content-hash skip cache.
 *
 * Persists a per-(tenant, recipe) digest of the last successfully-applied
 * IR alongside a digest of the env-profile roots that influence
 * compilation. On the next push, recipes whose IR digest + roots digest
 * both match the cached entry are treated as up-to-date and skipped
 * entirely — no plan-time reads, no per-op round trips. Trades a
 * narrow correctness window (out-of-band CMS edits to recipe-owned
 * items aren't auto-redetected until the recipe source changes) for a
 * substantial speedup on no-op re-pushes.
 *
 * Cache is opt-in via `--skip-unchanged-recipes`; default OFF so the
 * existing read-then-diff semantics stay the default for human
 * operators. The orchestrator's automated re-push path is the
 * intended primary consumer.
 *
 * File location: `<configDir>/.scai/recipe-cache.json`. Always-write
 * after a successful, non-aborted push; never persists partial state.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { OperationIr } from "./ir/operations";

export interface RecipeCacheEntry {
  irHash: string;
  lastApplied: string;
  summary: { create: number; update: number; skip: number };
}

export interface RecipeCacheTenant {
  rootsHash: string;
  recipes: Record<string, RecipeCacheEntry>;
}

export interface RecipeCacheFile {
  schemaVersion: "1";
  tenants: Record<string, RecipeCacheTenant>;
}

const CACHE_DIR = ".scai";
const CACHE_FILE = "recipe-cache.json";
const SCHEMA_VERSION = "1" as const;

const cachePath = (configDir: string): string => path.join(configDir, CACHE_DIR, CACHE_FILE);

export const hashIr = (ir: OperationIr): string =>
  createHash("sha256").update(JSON.stringify(ir)).digest("hex");

/**
 * Hash the env-profile roots that affect IR compilation. When any of
 * these change, the IR shape changes and the cached `irHash` is no
 * longer comparable — the cache entry is invalidated.
 */
export const hashRoots = (roots: Record<string, string | undefined>): string => {
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(roots).sort()) {
    const value = roots[key];
    if (value !== undefined) ordered[key] = value;
  }
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
};

const isCacheFile = (raw: unknown): raw is RecipeCacheFile => {
  if (!raw || typeof raw !== "object") return false;
  const file = raw as Partial<RecipeCacheFile>;
  return file.schemaVersion === SCHEMA_VERSION && typeof file.tenants === "object";
};

export const loadRecipeCache = async (configDir: string): Promise<RecipeCacheFile> => {
  const filePath = cachePath(configDir);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isCacheFile(parsed)) return parsed;
  } catch (error) {
    // ENOENT → first run. Anything else (corrupted JSON, stale schema)
    // also returns an empty cache; we'd rather rebuild silently than
    // fail the push. The next save overwrites the bad file.
    if ((error as { code?: string }).code !== "ENOENT") {
      // Corruption — treat as empty cache. (Could log via the caller's
      // logger but this path is hot and shouldn't pull in a logger
      // dependency.)
    }
  }
  return { schemaVersion: SCHEMA_VERSION, tenants: {} };
};

export const saveRecipeCache = async (configDir: string, cache: RecipeCacheFile): Promise<void> => {
  const filePath = cachePath(configDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
};

/**
 * Decide whether an IR can be skipped based on the cache. Returns
 * `null` when no cached entry applies (different roots hash, missing
 * entry, or schema mismatch); otherwise returns the cached summary
 * to surface in the push output.
 */
export const cachedSkipFor = (
  cache: RecipeCacheFile,
  envName: string,
  rootsHash: string,
  recipeHandle: string,
  irHash: string
): RecipeCacheEntry | null => {
  const tenant = cache.tenants[envName];
  if (!tenant) return null;
  if (tenant.rootsHash !== rootsHash) return null;
  const entry = tenant.recipes[recipeHandle];
  if (!entry) return null;
  if (entry.irHash !== irHash) return null;
  return entry;
};

export const recordCacheEntry = (
  cache: RecipeCacheFile,
  envName: string,
  rootsHash: string,
  recipeHandle: string,
  entry: RecipeCacheEntry
): void => {
  let tenant = cache.tenants[envName];
  if (!tenant || tenant.rootsHash !== rootsHash) {
    // Roots changed → drop all stale entries for this tenant; the
    // next save persists only the freshly-validated ones.
    tenant = { rootsHash, recipes: {} };
    cache.tenants[envName] = tenant;
  }
  tenant.recipes[recipeHandle] = entry;
};
