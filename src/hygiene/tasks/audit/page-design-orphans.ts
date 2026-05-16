import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  isPageDesignField,
  normalizeItemId,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";

export interface AuditPageDesignOrphansOptions extends HygieneCommonOptions {
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
}

export interface PageDesignOrphanReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  fieldName: string;
  pageDesignRef: string;
}

/**
 * XM Cloud SXA — find pages whose `__Final Page Design` / `__Page Design`
 * field references a missing item.
 */
export const runAuditPageDesignOrphans = async (
  options: AuditPageDesignOrphansOptions
): Promise<PageDesignOrphanReport[]> => {
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
      if (!isPageDesignField(field.name)) continue;
      if (!field.value || !field.value.trim()) continue;
      const refItemId = normalizeItemId(field.value.trim());
      if (refItemId.length !== 32) continue;
      pending.push({
        itemId: item.itemId,
        path: item.path,
        templateName: item.templateName,
        language: item.language,
        fieldName: field.name,
        refItemId,
      });
      refsToResolve.add(refItemId);
    }
  }

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

  const orphans: PageDesignOrphanReport[] = pending
    .filter((p) => refExists.get(p.refItemId) === false)
    .map((p) => ({
      itemId: p.itemId,
      path: p.path,
      templateName: p.templateName,
      language: p.language,
      fieldName: p.fieldName,
      pageDesignRef: p.refItemId,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.page-design-orphans.list",
    envName,
    results: orphans,
    summary: `Scanned ${scanned.length} items; ${orphans.length} reference missing page designs.`,
    formatLine: (r) => `${r.path} — ${r.fieldName}→${r.pageDesignRef.slice(0, 8)}`,
    extra: { root, scannedCount: scanned.length },
    options,
  });

  return orphans;
};
