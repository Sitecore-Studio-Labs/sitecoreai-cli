import {
  type HygieneCommonOptions,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface AuditAltTextMissingOptions extends HygieneCommonOptions {
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
}

export interface AltTextMissingReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  fieldName: string;
  mediaId: string | null;
}

/**
 * Audit content for Image-field values that have no alt text.
 *
 * Sitecore Image fields store XML like:
 *
 *   <image mediaid="{...}" alt="" width="..." height="..."/>
 *
 * Accessibility audits care about `alt=""` (empty) on real images.
 * The pattern matches the field value to detect Image-field XML
 * with an empty `alt` attribute, OR with the attribute absent
 * entirely.
 *
 * Notes:
 *   - This is a per-field check; an item may have multiple Image
 *     fields, each contributing to the report.
 *   - Decorative images intentionally use `alt=""` for screen-reader
 *     skipping. We can't distinguish those automatically — operators
 *     who use that pattern should baseline the affected items.
 */

const IMAGE_FIELD_PATTERN = /<image\b[^>]*\/>/gi;
const ALT_ATTR_PATTERN = /\balt=["']([^"']*)["']/i;
const MEDIA_ID_PATTERN = /\bmediaid=["']([^"']*)["']/i;

export const runAuditAltTextMissing = async (
  options: AuditAltTextMissingOptions
): Promise<AltTextMissingReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";

  const { scanned, fieldsByItemId, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  const reports: AltTextMissingReport[] = [];
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field.value) continue;
      if (field.name.startsWith("__")) continue;
      // Each <image> XML in this field — Image fields hold one; RichText
      // can hold many embedded as <img> (different tag we don't check
      // here; that's a separate concern).
      const matches = field.value.match(IMAGE_FIELD_PATTERN);
      if (!matches) continue;
      for (const tag of matches) {
        const altMatch = ALT_ATTR_PATTERN.exec(tag);
        const alt = altMatch ? altMatch[1].trim() : "";
        if (alt.length > 0) continue;
        const mediaMatch = MEDIA_ID_PATTERN.exec(tag);
        const mediaId = mediaMatch ? mediaMatch[1].replace(/[{}-]/g, "").toLowerCase() : null;
        reports.push({
          itemId: item.itemId,
          path: item.path,
          templateName: item.templateName,
          language: item.language,
          fieldName: field.name,
          mediaId,
        });
      }
    }
  }
  // Sort by path, then field name, so multi-field items group naturally.
  reports.sort((a, b) => a.path.localeCompare(b.path) || a.fieldName.localeCompare(b.fieldName));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.alt-text-missing.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; ${reports.length} Image field${reports.length === 1 ? " has" : "s have"} empty alt text.`,
    formatLine: (r) =>
      `${r.path} — ${r.fieldName}${r.mediaId ? ` (${r.mediaId.slice(0, 8)})` : ""}`,
    extra: { root, scannedCount: scanned.length },
    options,
  });

  return reports;
};
