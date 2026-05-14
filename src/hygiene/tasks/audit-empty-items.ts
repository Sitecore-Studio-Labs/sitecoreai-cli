import {
  type HygieneCommonOptions,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface AuditEmptyItemsOptions extends HygieneCommonOptions {
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  language?: string;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
}

export interface EmptyItemReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  createdDate: string | null;
  updatedDate: string | null;
}

/**
 * Audit content for items with no authored field values.
 */
export const runAuditEmptyItems = async (
  options: AuditEmptyItemsOptions
): Promise<EmptyItemReport[]> => {
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

  const empty: EmptyItemReport[] = [];
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const authored = fields.filter((f) => !f.name.startsWith("__"));
    if (authored.length === 0) continue; // folder-like (no author-facing fields).
    const hasValue = authored.some((f) => (f.value ?? "").trim().length > 0);
    if (hasValue) continue;
    empty.push({
      itemId: item.itemId,
      path: item.path,
      templateName: item.templateName,
      language: item.language,
      createdDate: item.createdDate,
      updatedDate: item.updatedDate,
    });
  }
  empty.sort((a, b) => a.path.localeCompare(b.path));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.empty-items.list",
    envName,
    results: empty,
    summary: `Scanned ${scanned.length} items; ${empty.length} have no authored content.`,
    formatLine: (r) =>
      `${r.path}${r.templateName ? ` (${r.templateName})` : ""}${r.language ? ` @${r.language}` : ""}`,
    extra: { root, scannedCount: scanned.length },
    options,
  });

  return empty;
};
