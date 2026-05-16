import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  extractPersonalizationRefs,
  isRenderingField,
  normalizeItemId,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";

export interface AuditPersonalizationBrokenOptions extends HygieneCommonOptions {
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
}

export interface PersonalizationBrokenReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  brokenRefs: Array<{ fieldName: string; refItemId: string }>;
}

/**
 * Audit page items for personalization rules referencing missing items.
 */
export const runAuditPersonalizationBroken = async (
  options: AuditPersonalizationBrokenOptions
): Promise<PersonalizationBrokenReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";

  const { scanned, fieldsByItemId, cache, knobs } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  type Pending = {
    itemId: string;
    path: string;
    templateName: string | null;
    language: string | null;
    fieldName: string;
    refItemId: string;
  };
  const pending: Pending[] = [];
  const refsToResolve = new Set<string>();
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!isRenderingField(field.name) || !field.value) continue;
      for (const raw of extractPersonalizationRefs(field.value)) {
        const norm = normalizeItemId(raw);
        if (norm.length !== 32) continue;
        if (norm === item.itemId) continue;
        pending.push({
          itemId: item.itemId,
          path: item.path,
          templateName: item.templateName,
          language: item.language,
          fieldName: field.name,
          refItemId: norm,
        });
        refsToResolve.add(norm);
      }
    }
  }
  logger.verbose(`Found ${pending.length} personalization refs (${refsToResolve.size} distinct).`);

  const refExists = new Map<string, boolean>();
  const refList = Array.from(refsToResolve);
  const refBatches: string[][] = [];
  for (let i = 0; i < refList.length; i += knobs.batchSize) {
    refBatches.push(refList.slice(i, i + knobs.batchSize));
  }
  const existResults = await mapWithConcurrency(
    refBatches,
    (ids) => client.itemsExistBatch(ids),
    knobs.concurrency
  );
  for (const m of existResults) for (const [id, exists] of m) refExists.set(id, exists);

  const byItem = new Map<string, PersonalizationBrokenReport>();
  for (const p of pending) {
    if (refExists.get(p.refItemId) !== false) continue;
    const existing = byItem.get(p.itemId);
    const entry = { fieldName: p.fieldName, refItemId: p.refItemId };
    if (existing) {
      if (!existing.brokenRefs.some((b) => b.refItemId === entry.refItemId)) {
        existing.brokenRefs.push(entry);
      }
    } else {
      byItem.set(p.itemId, {
        itemId: p.itemId,
        path: p.path,
        templateName: p.templateName,
        language: p.language,
        brokenRefs: [entry],
      });
    }
  }
  const reports = Array.from(byItem.values()).sort((a, b) => a.path.localeCompare(b.path));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.personalization-broken.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; ${reports.length} have broken personalization refs.`,
    formatLine: (r) =>
      `${r.path} — ${r.brokenRefs.length} broken: ${r.brokenRefs
        .slice(0, 3)
        .map((b) => b.refItemId.slice(0, 8))
        .join(", ")}${r.brokenRefs.length > 3 ? "…" : ""}`,
    extra: { root, scannedCount: scanned.length },
    options,
  });

  return reports;
};
