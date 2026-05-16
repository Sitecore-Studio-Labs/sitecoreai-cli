import {
  type HygieneCommonOptions,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";

export interface AuditLargeFieldsOptions extends HygieneCommonOptions {
  /** Size threshold in bytes for a field to count as "large". Default 100_000. */
  threshold?: number;
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
  /** Include __-prefixed system fields in the size check. Off by default. */
  includeSystemFields?: boolean;
}

export interface LargeFieldReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  largeFields: Array<{ fieldName: string; size: number }>;
  totalSize: number;
}

/**
 * Audit content for field values exceeding a size threshold.
 *
 * Common culprits: RichText pasted from Word (huge HTML blobs), raw
 * JSON dumps in text fields, base64-embedded images in HTML.
 * Defaults to 100KB per field — the byte size where renders start
 * impacting LCP and authoring tools start lagging.
 *
 * Strategy:
 *   1. Use `scanItemsAndFields` to enumerate + fetch fields.
 *   2. For each non-system field, byte-length check against threshold.
 *   3. Report per-item; sort by total bloated bytes desc.
 */
export const runAuditLargeFields = async (
  options: AuditLargeFieldsOptions
): Promise<LargeFieldReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const threshold = options.threshold ?? 100_000;
  const includeSystemFields = Boolean(options.includeSystemFields);

  const { scanned, fieldsByItemId, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  const reports: LargeFieldReport[] = [];
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const large: Array<{ fieldName: string; size: number }> = [];
    let total = 0;
    for (const field of fields) {
      if (!field.value) continue;
      if (!includeSystemFields && field.name.startsWith("__")) continue;
      const size = Buffer.byteLength(field.value, "utf8");
      if (size >= threshold) {
        large.push({ fieldName: field.name, size });
        total += size;
      }
    }
    if (large.length > 0) {
      reports.push({
        itemId: item.itemId,
        path: item.path,
        templateName: item.templateName,
        language: item.language,
        largeFields: large,
        totalSize: total,
      });
    }
  }
  reports.sort((a, b) => b.totalSize - a.totalSize);

  await cache?.flush();

  printReport({
    logger,
    command: "audit.large-fields.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; ${reports.length} have fields >= ${formatBytes(threshold)}.`,
    formatLine: (r) =>
      `${r.path} — ${formatBytes(r.totalSize)} across ${r.largeFields.length} field${r.largeFields.length === 1 ? "" : "s"}: ${r.largeFields
        .slice(0, 3)
        .map((f) => `${f.fieldName}(${formatBytes(f.size)})`)
        .join(", ")}${r.largeFields.length > 3 ? "…" : ""}`,
    extra: { root, threshold, scannedCount: scanned.length },
    options,
  });

  return reports;
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
};
