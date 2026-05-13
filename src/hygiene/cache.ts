import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Logger } from "@/shared/logger";
import type { ItemField } from "./api/client";

/**
 * Cross-audit field cache.
 *
 * Many hygiene audits make the same shape of read: search-paginate
 * → fetch fields per item via `getItemFieldsBatch`. Running multiple
 * audits back-to-back (e.g. `broken-links` then `unused-media` then
 * `duplicates`) re-fetches the same field bundles, each round trip
 * costing ~150-300ms.
 *
 * This cache stores per-item field bundles keyed by `(envName, itemId,
 * updatedDate)`. The updatedDate from the search index serves as a
 * cheap freshness check — if the cached entry's updatedDate matches
 * the search result's updatedDate, we can skip the field fetch and
 * use the cached bundle.
 *
 * **When is it correct to use?** Reads are diagnostic-shaped: if the
 * cache returns slightly-stale data, the worst case is a false-positive
 * audit flag (the operator goes to look at an item that was already
 * fixed). No mutations consult the cache. The `updatedDate` invariant
 * also means changes show up within one search-index refresh window
 * (typically seconds-to-minutes on XM Cloud).
 *
 * **Storage.** JSON file at `~/.sitecoreai/audit-cache/<envName>.json`.
 * Per-env files mean cross-tenant isolation; one corrupt file doesn't
 * sink all caches. LRU-capped at 50_000 entries to keep file size
 * bounded (typical entry is ~500 bytes, capping at ~25MB per env).
 */

const DEFAULT_MAX_ENTRIES = 50_000;
const CACHE_DIR = path.join(os.homedir(), ".sitecoreai", "audit-cache");
const CACHE_VERSION = 1;

interface CacheEntry {
  updatedDate: string;
  fields: ItemField[];
  lastAccessed: number;
}

interface CacheFile {
  version: number;
  envName: string;
  entries: Record<string, CacheEntry>;
}

export interface FieldCacheOptions {
  envName: string;
  maxEntries?: number;
  cacheDir?: string;
  logger?: Logger;
}

export interface FieldCache {
  /** Look up cached fields. Returns null on miss or stale entry. */
  get(itemId: string, updatedDate: string | null | undefined): ItemField[] | null;
  /** Store a field bundle. No-op when `updatedDate` is missing. */
  set(itemId: string, updatedDate: string | null | undefined, fields: ItemField[]): void;
  /** Persist the cache to disk. Safe to call multiple times. */
  flush(): Promise<void>;
  /** Read-only stats for reporting. */
  stats(): { hits: number; misses: number; size: number };
}

const resolveCacheFile = (envName: string, baseDir: string): string =>
  path.join(baseDir, `${envName.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);

const loadCache = (filePath: string, envName: string, logger?: Logger): CacheFile => {
  if (!fs.existsSync(filePath)) {
    return { version: CACHE_VERSION, envName, entries: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.version !== CACHE_VERSION || parsed.envName !== envName) {
      // Wrong-version or wrong-env file → start fresh, don't blow up.
      return { version: CACHE_VERSION, envName, entries: {} };
    }
    return parsed;
  } catch (error) {
    logger?.warn(
      `Audit cache for env ${envName} is unreadable; starting fresh. (${
        error instanceof Error ? error.message : String(error)
      })`
    );
    return { version: CACHE_VERSION, envName, entries: {} };
  }
};

const saveCache = (filePath: string, file: CacheFile, logger?: Logger): void => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(file), "utf8");
  } catch (error) {
    logger?.warn(
      `Failed to persist audit cache to ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

export const createFieldCache = (options: FieldCacheOptions): FieldCache => {
  const baseDir = options.cacheDir ?? CACHE_DIR;
  const filePath = resolveCacheFile(options.envName, baseDir);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const file = loadCache(filePath, options.envName, options.logger);
  let hits = 0;
  let misses = 0;
  let dirty = false;

  const evictLruIfNeeded = (): void => {
    const keys = Object.keys(file.entries);
    if (keys.length <= maxEntries) return;
    const sorted = keys
      .map((k) => ({ k, t: file.entries[k]!.lastAccessed }))
      .sort((a, b) => a.t - b.t);
    const dropCount = keys.length - maxEntries;
    for (let i = 0; i < dropCount; i += 1) {
      delete file.entries[sorted[i].k];
    }
  };

  return {
    get(itemId, updatedDate) {
      if (!updatedDate) {
        misses += 1;
        return null;
      }
      const entry = file.entries[itemId];
      if (!entry) {
        misses += 1;
        return null;
      }
      if (entry.updatedDate !== updatedDate) {
        // Stale — drop it; next set() will repopulate.
        delete file.entries[itemId];
        dirty = true;
        misses += 1;
        return null;
      }
      entry.lastAccessed = Date.now();
      dirty = true;
      hits += 1;
      return entry.fields;
    },

    set(itemId, updatedDate, fields) {
      if (!updatedDate) return;
      file.entries[itemId] = {
        updatedDate,
        fields,
        lastAccessed: Date.now(),
      };
      dirty = true;
      evictLruIfNeeded();
    },

    async flush() {
      if (!dirty) return;
      saveCache(filePath, file, options.logger);
      dirty = false;
    },

    stats() {
      return {
        hits,
        misses,
        size: Object.keys(file.entries).length,
      };
    },
  };
};

/**
 * Wrap `getItemFieldsBatch` with a field-cache layer. The returned
 * function consults the cache first per item, then defers to the
 * underlying batch for any cache misses, and finally writes the
 * fresh results back into the cache.
 *
 * `searchResults` is required so the wrapper knows each item's
 * `updatedDate` — that's the cache freshness key. Callers pass the
 * search results from the same enumeration pass.
 */
export const wrapFieldsBatchWithCache = (
  underlying: (itemIds: readonly string[]) => Promise<Map<string, ItemField[] | null>>,
  cache: FieldCache,
  updatedDateByItemId: Map<string, string | null>
) => {
  return async (itemIds: readonly string[]): Promise<Map<string, ItemField[] | null>> => {
    const result = new Map<string, ItemField[] | null>();
    const misses: string[] = [];
    for (const id of itemIds) {
      const updated = updatedDateByItemId.get(id);
      const cached = cache.get(id, updated);
      if (cached) {
        result.set(id, cached);
      } else {
        misses.push(id);
      }
    }
    if (misses.length > 0) {
      const fresh = await underlying(misses);
      for (const [id, fields] of fresh) {
        result.set(id, fields);
        if (fields) {
          cache.set(id, updatedDateByItemId.get(id), fields);
        }
      }
    }
    return result;
  };
};

export const isAuditCacheEnabled = (): boolean => {
  const v = (process.env.SITECOREAI_AUDIT_CACHE ?? "").toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "on";
};
