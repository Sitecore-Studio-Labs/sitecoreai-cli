import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  normalizeItemId,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";

export interface AuditReferencesOptions extends HygieneCommonOptions {
  /** Required. Item ID to find inbound references for. Any GUID form accepted. */
  to?: string;
  /** Content root to scan. Default `/sitecore/content`. */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  language?: string;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  /** Include `__`-prefixed system fields in the scan. On by default — that's where most refs live. */
  includeSystemFields?: boolean;
  /** Restrict the scan to these field names. */
  fields?: string[];
  /**
   * Suppress the audit's own report. Used by cleanup tasks that call
   * this audit as a pre-flight check and surface blockers in their own
   * combined report rather than as a separate audit record. Pair with
   * `cache: true` when running back-to-back checks against the same
   * `--root` so subsequent calls hit the field cache. Default false.
   */
  silent?: boolean;
}

export interface ReferenceReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  /** One entry per field that mentions the target. */
  matches: Array<{
    fieldName: string;
    /**
     * How the target appears in the field value: as a raw 32-char id
     * (`abc123…`), a dashed id (`abc-123-…`), a curly-wrapped id
     * (`{abc-123-…}`), or a path that contains the target's normalized
     * id. Mostly diagnostic — the operator usually just needs to know
     * "this field references the target," not which form.
     */
    form: "flat" | "dashed" | "curly-upper" | "curly-lower" | "path-ancestor";
  }>;
}

/**
 * Build the candidate strings we'll search for in field values.
 * Sitecore stores GUIDs in many forms depending on the field type
 * and authoring path — multi-list fields use `{ABC-DEF-…}` separated
 * by `|`, droplist values are `{abc-def-…}` or raw dashed, link XML
 * uses `id="ABC..."`, and computed `_path` mirrors stored as flat
 * concatenations. Match permissively so a single audit catches the
 * full surface.
 */
const buildPatterns = (
  normalized: string
): Array<{ pattern: string; form: ReferenceReport["matches"][number]["form"] }> => {
  const flat = normalized;
  const dashed = `${flat.slice(0, 8)}-${flat.slice(8, 12)}-${flat.slice(12, 16)}-${flat.slice(16, 20)}-${flat.slice(20)}`;
  return [
    { pattern: flat, form: "flat" },
    { pattern: dashed, form: "dashed" },
    { pattern: `{${dashed.toUpperCase()}}`, form: "curly-upper" },
    { pattern: `{${dashed}}`, form: "curly-lower" },
  ];
};

/**
 * Inbound-reference scan: walk items + fields under `--root` and
 * report every field whose value mentions the target item id in any
 * of the canonical Sitecore GUID forms. The companion primitive to
 * `audit template-dependencies` — that audit uses the search index's
 * indexed-field criteria (template-specific signals like `__masters`,
 * `_basetemplates`); this one walks raw field values to catch the
 * long tail of custom droplist/treelist/link fields the index doesn't
 * classify.
 *
 * Performance: cost scales with `--root` size, not with how many
 * references actually exist. On a tenant with 50k items, expect
 * 30s–2min depending on `--page-parallelism` and `--concurrency`. The
 * field cache (`--cache`) makes re-runs against the same root nearly
 * free for the unchanged items.
 *
 * Use this when:
 *   - The target is NOT a template (template-dependencies has stronger
 *     signals for templates).
 *   - `audit template-dependencies` returned empty and you suspect a
 *     custom field type the index doesn't classify.
 *   - You need to find every author-facing field referencing a media
 *     item / rendering / data-source before deleting it.
 */
export const runAuditReferences = async (
  options: AuditReferencesOptions
): Promise<ReferenceReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  if (!options.to) {
    throw createScaiError("audit references requires --to <itemId>.", "INPUT_INVALID");
  }
  const normalized = normalizeItemId(options.to);
  const root = options.root ?? "/sitecore/content";

  const patterns = buildPatterns(normalized);
  const fieldFilter = options.fields?.length
    ? new Set(options.fields.map((f) => f.toLowerCase()))
    : null;
  // Default to ON for system fields — these audits exist precisely
  // because system fields (`__Renderings`, `__Layout`, `__masters`,
  // and so on) carry most cross-item references in Sitecore.
  const includeSystemFields = options.includeSystemFields ?? true;

  logger.verbose(`Scanning ${root} for references to ${normalized}.`);

  const { scanned, fieldsByItemId, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  const reports: ReferenceReport[] = [];
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    // Self-reference is uninteresting noise — every item's _path /
    // _ancestors fields contain its own id.
    if (item.itemId === normalized) continue;

    const fieldMatches: ReferenceReport["matches"] = [];
    for (const field of fields) {
      if (!field.value) continue;
      if (fieldFilter && !fieldFilter.has(field.name.toLowerCase())) continue;
      if (!includeSystemFields && field.name.startsWith("__")) continue;
      // Match permissively: any of the canonical id forms appearing
      // anywhere in the field value counts as a reference. Pick the
      // most specific form seen so the report tells the operator
      // "this is a curly-wrapped GUID, probably a multi-list" vs.
      // "this is a flat 32-char id, probably an index-only mirror."
      let bestForm: ReferenceReport["matches"][number]["form"] | null = null;
      const lower = field.value.toLowerCase();
      for (const { pattern, form } of patterns) {
        const target = form === "curly-upper" ? field.value : lower;
        const needle = form === "curly-upper" ? pattern : pattern.toLowerCase();
        if (target.includes(needle)) {
          bestForm = form;
          // Curly forms are more specific than dashed; dashed is more
          // specific than flat. Keep the more specific one when both
          // would match a substring.
          if (form.startsWith("curly")) break;
        }
      }
      if (bestForm) {
        fieldMatches.push({ fieldName: field.name, form: bestForm });
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

  if (!options.silent) {
    printReport({
      logger,
      command: "audit.references.list",
      envName,
      results: reports,
      summary: `Scanned ${scanned.length} items under ${root}; ${reports.length} item(s) reference ${normalized}.`,
      formatLine: (r) =>
        `${r.path} — ${r.matches
          .slice(0, 3)
          .map((m) => `${m.fieldName}(${m.form})`)
          .join(", ")}${r.matches.length > 3 ? "…" : ""}`,
      extra: { to: normalized, root, scannedCount: scanned.length },
      options,
    });
  }

  return reports;
};
