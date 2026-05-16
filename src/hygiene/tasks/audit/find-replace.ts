import {
  type HygieneCommonOptions,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";
import { createScaiError } from "@/shared/errors";

export interface AuditFindReplaceOptions extends HygieneCommonOptions {
  /** Required. Regex pattern (without slashes) or literal string to search for. */
  pattern: string;
  /** Treat `pattern` as a literal string instead of a regex. */
  literal?: boolean;
  /** Regex flags. Default `g` (case-sensitive). Combined with `i` if `--ignore-case`. */
  flags?: string;
  /** Lowercase the search before matching. */
  ignoreCase?: boolean;
  /**
   * Only inspect these field names. Default: all author-facing fields
   * (non-`__`-prefixed). Multiple values may be passed as a
   * comma-separated list at the CLI layer.
   */
  fields?: string[];
  /** Include `__`-prefixed system fields in the search. Off by default. */
  includeSystemFields?: boolean;
  /** Content root. Default `/sitecore/content`. */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  language?: string;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  /** Cap on matches reported per item (default 10). */
  maxMatchesPerItem?: number;
}

export interface FindReplaceMatch {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  matches: Array<{
    fieldName: string;
    matchCount: number;
    /** Up to `--max-matches-per-item` example match snippets (≤ 80 chars each). */
    samples: string[];
  }>;
}

const compilePattern = (pattern: string, options: AuditFindReplaceOptions): RegExp => {
  if (!pattern) {
    throw createScaiError("--pattern is required.", "INPUT_INVALID");
  }
  const baseFlags = options.flags ?? "g";
  const flags = options.ignoreCase
    ? baseFlags.includes("i")
      ? baseFlags
      : baseFlags + "i"
    : baseFlags;
  if (!flags.includes("g")) {
    // Force `g` so we can count and collect samples in one pass.
    return new RegExp(escapeIfLiteral(pattern, options.literal), flags + "g");
  }
  return new RegExp(escapeIfLiteral(pattern, options.literal), flags);
};

const escapeIfLiteral = (pattern: string, literal?: boolean): string =>
  literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;

const snippet = (value: string, matchIndex: number, matchLen: number): string => {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(value.length, matchIndex + matchLen + 30);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < value.length ? "…" : "";
  return prefix + value.slice(start, end).replace(/\s+/g, " ") + suffix;
};

/**
 * Audit content for fields matching a pattern. Read-only; pair with
 * `scai hygiene cleanup find-replace` to apply replacements.
 *
 * Strategy:
 *   1. Enumerate items via `scanItemsAndFields` (full perf-knobs +
 *      cache support).
 *   2. For each field that survives the `--fields` filter (and the
 *      system-field exclusion), run the compiled pattern, count
 *      matches, capture up to `--max-matches-per-item` sample
 *      snippets.
 *   3. Emit one report row per (item, field) pair that has at least
 *      one match.
 *
 * Patterns:
 *   - Default: full regex. Operators escape special chars themselves.
 *   - `--literal`: treat pattern as a literal string (special chars
 *     auto-escaped). Useful for find-and-replace of URLs, GUIDs, etc.
 *   - `--ignore-case`: append `i` to the flags. Combines with `--literal`.
 *
 * Notes:
 *   - The patterns are JS regex (`RegExp`), not Sitecore Lucene query
 *     syntax. This means `\\b`, capture groups, lookaheads, and back-
 *     references all work; whereas Sitecore search index queries
 *     wouldn't accept those.
 *   - Field-level matches are reported with snippets containing 30
 *     chars of context on each side. Whitespace runs are normalized
 *     for display.
 */
export const runAuditFindReplace = async (
  options: AuditFindReplaceOptions
): Promise<FindReplaceMatch[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const maxSamples = options.maxMatchesPerItem ?? 10;

  const regex = compilePattern(options.pattern, options);
  const fieldFilter = options.fields?.length
    ? new Set(options.fields.map((f) => f.toLowerCase()))
    : null;
  const includeSystemFields = Boolean(options.includeSystemFields);

  const { scanned, fieldsByItemId, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  const reports: FindReplaceMatch[] = [];
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const fieldMatches: FindReplaceMatch["matches"] = [];
    for (const field of fields) {
      if (!field.value) continue;
      if (fieldFilter && !fieldFilter.has(field.name.toLowerCase())) continue;
      if (!includeSystemFields && field.name.startsWith("__")) continue;
      regex.lastIndex = 0;
      let matchCount = 0;
      const samples: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(field.value)) !== null) {
        matchCount += 1;
        if (samples.length < maxSamples) {
          samples.push(snippet(field.value, m.index, m[0].length));
        }
        // Defend against zero-width matches.
        if (m.index === regex.lastIndex) regex.lastIndex += 1;
      }
      if (matchCount > 0) {
        fieldMatches.push({ fieldName: field.name, matchCount, samples });
      }
    }
    if (fieldMatches.length > 0) {
      reports.push({
        itemId: item.itemId,
        path: item.path,
        templateName: item.templateName,
        language: item.language,
        matches: fieldMatches,
      });
    }
  }

  reports.sort((a, b) => a.path.localeCompare(b.path));
  await cache?.flush();

  const totalMatches = reports.reduce(
    (n, r) => n + r.matches.reduce((m, f) => m + f.matchCount, 0),
    0
  );
  printReport({
    logger,
    command: "audit.find-replace.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; ${reports.length} items match (${totalMatches} total occurrences).`,
    formatLine: (r) =>
      `${r.path} — ${r.matches
        .slice(0, 2)
        .map((f) => `${f.fieldName}(${f.matchCount}×): "${f.samples[0]}"`)
        .join("; ")}${r.matches.length > 2 ? "…" : ""}`,
    extra: {
      pattern: options.pattern,
      literal: Boolean(options.literal),
      ignoreCase: Boolean(options.ignoreCase),
      root,
      scannedCount: scanned.length,
      totalMatches,
    },
    options,
  });

  return reports;
};

export { compilePattern as _compilePatternForTest };
