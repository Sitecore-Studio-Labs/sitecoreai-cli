import {
  type HygieneCommonOptions,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";

export interface AuditMissingMetaOptions extends HygieneCommonOptions {
  /**
   * Required field names that should have a non-empty value on every
   * scanned item. Defaults to the common SEO set: meta-title,
   * meta-description, og-image, og-title.
   */
  requiredFields?: string[];
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
  exclude?: string[];
  since?: string;
  owner?: string;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
  /**
   * Restrict by template name (or pattern). When set, only items
   * whose templateName matches are checked. Default: all items —
   * this can be noisy, so most operators will scope to "Page"
   * templates with `--template-pattern Page`.
   */
  templatePattern?: string;
}

export interface MissingMetaReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  missingFields: string[];
}

const DEFAULT_REQUIRED = ["meta-title", "meta-description", "og-image", "og-title"];

/**
 * Audit content for items missing required (SEO) field values.
 *
 * Strategy:
 *   1. Enumerate items via `scanItemsAndFields`.
 *   2. For each, check that every required field is present and
 *      non-empty (whitespace-only counts as missing).
 *   3. Field-name matching is case-insensitive and falls back to
 *      Title-Case-To-Hyphenated variants ("Meta Description" ↔
 *      "meta-description") to tolerate template naming styles.
 *
 * The default required set is SEO-oriented. Pass `--required-fields
 * "title,banner-image,...` to define your own per-project policy.
 *
 * `--template-pattern` scopes the check — typically you want to
 * apply this only to Page templates, not Datasource items.
 */
export const runAuditMissingMeta = async (
  options: AuditMissingMetaOptions
): Promise<MissingMetaReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const required = (options.requiredFields?.length ? options.requiredFields : DEFAULT_REQUIRED).map(
    (s) => s.toLowerCase()
  );
  const templateRegex = options.templatePattern ? new RegExp(options.templatePattern, "i") : null;

  const { scanned, fieldsByItemId, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  const reports: MissingMetaReport[] = [];
  for (const item of scanned) {
    if (templateRegex && !templateRegex.test(item.templateName ?? "")) continue;
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    // Track two sets:
    //   - `present` — every field the item's template defines (regardless
    //     of value). If a required field isn't in this set, the template
    //     itself doesn't declare it, which is a content-model decision,
    //     not a content-quality issue — skip rather than flag.
    //   - `populated` — fields whose value is non-empty after trimming.
    // A required field is reported missing only when `present && !populated`.
    // Prior to this distinction the audit fired on every item in tenants
    // whose content model didn't include the SEO field set at all (e.g.
    // an internal-tools tenant without `meta-title`), generating one
    // finding per item across the entire content tree.
    const present = new Set<string>();
    const populated = new Set<string>();
    for (const f of fields) {
      const name = f.name.toLowerCase();
      const hyphenated = name.replace(/\s+/g, "-");
      present.add(name);
      present.add(hyphenated);
      if (f.value && f.value.trim()) {
        populated.add(name);
        populated.add(hyphenated);
      }
    }
    const missing: string[] = [];
    for (const req of required) {
      if (!present.has(req)) continue;
      if (!populated.has(req)) missing.push(req);
    }
    if (missing.length > 0) {
      reports.push({
        itemId: item.itemId,
        path: item.path,
        templateName: item.templateName,
        language: item.language,
        missingFields: missing,
      });
    }
  }
  reports.sort((a, b) => a.path.localeCompare(b.path));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.missing-meta.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; ${reports.length} missing required field${required.length === 1 ? "" : "s"} (${required.join(", ")}).`,
    formatLine: (r) => `${r.path} — missing: ${r.missingFields.join(", ")}`,
    extra: { root, requiredFields: required, scannedCount: scanned.length },
    options,
  });

  return reports;
};
