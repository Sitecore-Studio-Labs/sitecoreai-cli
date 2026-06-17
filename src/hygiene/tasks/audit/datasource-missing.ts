import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  extractRenderingDatasources,
  isRenderingField,
  normalizeItemId,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";

export interface AuditDatasourceMissingOptions extends HygieneCommonOptions {
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  /**
   * Whether to flag Sitecore-query datasources (values prefixed with
   * `query:`). They can't be resolved statically. Default false —
   * skip them; setting true emits them as a "skipped" diagnostic.
   */
  reportQueryDatasources?: boolean;
}

export interface DatasourceMissingReport {
  itemId: string;
  path: string;
  templateName?: string | null;
  language?: string | null;
  missingDatasources: Array<{
    fieldName: string;
    renderingId: string | null;
    datasource: string;
  }>;
}

/**
 * Audit page items for rendering datasources that don't resolve.
 *
 * Uses `scanItemsAndFields` for the enumeration + field-read pipeline
 * (concurrency, batch size, page parallelism, optional cache all come
 * from there). Parses `__Renderings` / `__Final Renderings` XML and
 * resolves the embedded `ds=` / `s:ds=` attribute values against the
 * tenant's item index.
 *
 * Datasource values come in three shapes — paths, bare GUIDs, and
 * `query:` selectors. Paths are resolved via batched `_fullpath`
 * searches; GUIDs via `itemsExistBatch`; `query:` selectors are
 * skipped by default (or emitted as diagnostics with
 * `--report-query-datasources`).
 */
export const runAuditDatasourceMissing = async (
  options: AuditDatasourceMissingOptions
): Promise<DatasourceMissingReport[]> => {
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
    renderingId: string | null;
    datasource: string;
  };
  const pending: Pending[] = [];
  const idsToResolve = new Set<string>();
  const pathsToResolve = new Set<string>();
  // Collect every datasource ref on a single rendering field, pushing
  // onto `pending` and the id/path resolution sets. Extracted to keep
  // the scan loop nesting shallow.
  const collectFieldDatasources = (
    item: (typeof scanned)[number],
    field: { name: string; value: string }
  ): void => {
    for (const ds of extractRenderingDatasources(field.value)) {
      if (!ds.datasource) continue;
      if (ds.datasource.startsWith("query:") || ds.datasource.startsWith("local:")) {
        if (!options.reportQueryDatasources) continue;
      }
      pending.push({
        itemId: item.itemId,
        path: item.path,
        templateName: item.templateName,
        language: item.language,
        fieldName: field.name,
        renderingId: ds.renderingId,
        datasource: ds.datasource,
      });
      if (ds.datasource.startsWith("/")) {
        pathsToResolve.add(ds.datasource);
      } else {
        const norm = normalizeItemId(ds.datasource);
        if (norm.length === 32) idsToResolve.add(norm);
      }
    }
  };
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!isRenderingField(field.name) || !field.value) continue;
      collectFieldDatasources(item, field);
    }
  }
  logger.verbose(
    `Found ${pending.length} datasource refs; resolving ${idsToResolve.size} ids + ${pathsToResolve.size} paths.`
  );

  // Resolve item-id refs in batches with the perf knobs.
  const idExists = new Map<string, boolean>();
  const idList = Array.from(idsToResolve);
  const idBatches: string[][] = [];
  for (let i = 0; i < idList.length; i += knobs.batchSize) {
    idBatches.push(idList.slice(i, i + knobs.batchSize));
  }
  const idResults = await mapWithConcurrency(
    idBatches,
    (ids) => client.itemsExistBatch(ids),
    knobs.concurrency
  );
  for (const m of idResults) for (const [id, exists] of m) idExists.set(id, exists);

  // Resolve path refs concurrently.
  const pathExists = new Map<string, boolean>();
  await mapWithConcurrency(
    Array.from(pathsToResolve),
    async (p) => {
      const r = await client.search({
        index: options.index,
        paging: { pageSize: 1 },
        searchStatement: {
          criteria: { field: "_fullpath", value: p.toLowerCase(), criteriaType: "EXACT" },
        },
      });
      pathExists.set(p, r.totalCount > 0);
    },
    knobs.concurrency
  );

  // Build the per-item report.
  const byItem = new Map<string, DatasourceMissingReport>();
  for (const p of pending) {
    let broken = false;
    if (p.datasource.startsWith("query:") || p.datasource.startsWith("local:")) {
      broken = true; // operator opted in
    } else if (p.datasource.startsWith("/")) {
      broken = pathExists.get(p.datasource) === false;
    } else {
      const norm = normalizeItemId(p.datasource);
      if (norm.length === 32) broken = idExists.get(norm) === false;
    }
    if (!broken) continue;
    const entry = {
      fieldName: p.fieldName,
      renderingId: p.renderingId,
      datasource: p.datasource,
    };
    const existing = byItem.get(p.itemId);
    if (existing) {
      existing.missingDatasources.push(entry);
    } else {
      byItem.set(p.itemId, {
        itemId: p.itemId,
        path: p.path,
        templateName: p.templateName,
        language: p.language,
        missingDatasources: [entry],
      });
    }
  }
  const reports = Array.from(byItem.values()).sort((a, b) => a.path.localeCompare(b.path));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.datasource-missing.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; ${reports.length} have rendering datasources that don't resolve.`,
    formatLine: (r) =>
      `${r.path} (${r.missingDatasources.length} missing: ${r.missingDatasources
        .slice(0, 2)
        .map((d) => `${d.fieldName}→${d.datasource}`)
        .join(", ")}${r.missingDatasources.length > 2 ? "…" : ""})`,
    extra: { root, scannedCount: scanned.length },
    options,
  });

  return reports;
};
