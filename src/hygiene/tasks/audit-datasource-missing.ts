import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  extractRenderingDatasources,
  isRenderingField,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditDatasourceMissingOptions extends HygieneCommonOptions {
  /** Content root to scan. Default `/sitecore/content`. */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Include `/sitecore/system` items in the scan. */
  includeSystem?: boolean;
  /** Batch size for field-fetches and ref-resolution. Default 25. */
  batchSize?: number;
  /**
   * Whether to flag Sitecore-query datasources (values prefixed with
   * `query:`). They can't be resolved statically. Default false —
   * skip them; setting true emits them as a "skipped" diagnostic
   * rather than a broken ref.
   */
  reportQueryDatasources?: boolean;
}

export interface DatasourceMissingReport {
  itemId: string;
  path: string;
  templateName?: string | null;
  language?: string | null;
  /**
   * Broken datasource refs from `__Renderings` / `__Final Renderings`
   * fields. Each entry includes the rendering instance id (if available)
   * and the unresolvable datasource value (path or itemId).
   */
  missingDatasources: Array<{
    fieldName: string;
    renderingId: string | null;
    datasource: string;
  }>;
}

/**
 * Audit page items for rendering datasources that don't resolve.
 *
 * Strategy:
 *   1. Enumerate items under `--root` via search.
 *   2. Fetch fields in batches; for each `__Renderings` /
 *      `__Final Renderings` value, parse `<r ds="..." />` attrs.
 *   3. Datasource values come in three shapes — content-tree paths,
 *      bare itemId GUIDs, and `query:` selectors. Resolve paths and
 *      GUIDs via batched lookups (paths via `_fullpath` search, GUIDs
 *      via `itemsExistBatch`); skip `query:` (or report as diagnostic).
 *   4. Emit a row per (item, broken-datasource) pair.
 *
 * Notes:
 *   - The dotnet `Sitecore.DevEx` plugin had access to the SQL link
 *     database which indexes presentation datasources directly. The
 *     Authoring GraphQL path requires parsing the XML field values
 *     ourselves — same as broken-links does for RichText.
 *   - Datasource paths can target items in any tree (typically
 *     `/sitecore/content/<site>/Data/`), so the path-resolution step
 *     can't be scoped to `--root`. Refs to items outside `--root` are
 *     still resolved against the full master DB.
 */
export const runAuditDatasourceMissing = async (
  options: AuditDatasourceMissingOptions
): Promise<DatasourceMissingReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const limit = options.limit ?? 5000;
  const batchSize = options.batchSize ?? 25;
  const includeSystem = Boolean(options.includeSystem);

  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;

  const scanned: Array<{
    itemId: string;
    path: string;
    templateName: string | null;
    language: string | null;
  }> = [];
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      ...(rootItemId && { searchStatement: buildPathFilterStatement(rootItemId) }),
    },
    100
  )) {
    if (!includeSystem && isSystemPath(r.path)) continue;
    scanned.push({
      itemId: normalizeItemId(r.itemId),
      path: r.path,
      templateName: r.templateName ?? null,
      language: r.language?.name ?? null,
    });
    if (scanned.length >= limit) break;
  }
  logger.verbose(`Scanned ${scanned.length} items; reading fields in batches of ${batchSize}.`);

  const fieldsByItemId = new Map<string, Awaited<ReturnType<typeof client.getItemFieldsBatch>>>();
  const batches: string[][] = [];
  for (let i = 0; i < scanned.length; i += batchSize) {
    batches.push(scanned.slice(i, i + batchSize).map((s) => s.itemId));
  }
  const fieldBatchResults = await mapWithConcurrency(
    batches,
    (ids) => client.getItemFieldsBatch(ids),
    4
  );
  for (const m of fieldBatchResults) {
    for (const [id, fields] of m) fieldsByItemId.set(id, fields as never);
  }

  // Collect (item, fieldName, datasourceRef) triples.
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
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!isRenderingField(field.name) || !field.value) continue;
      const datasources = extractRenderingDatasources(field.value);
      for (const ds of datasources) {
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
    }
  }
  logger.verbose(
    `Found ${pending.length} datasource refs; resolving ${idsToResolve.size} ids + ${pathsToResolve.size} paths.`
  );

  // Resolve item-id refs in batches.
  const idExists = new Map<string, boolean>();
  const idList = Array.from(idsToResolve);
  for (let i = 0; i < idList.length; i += batchSize) {
    const batch = idList.slice(i, i + batchSize);
    const result = await client.itemsExistBatch(batch);
    for (const [id, exists] of result) idExists.set(id, exists);
  }

  // Resolve path refs via search `_fullpath` lookups. One search per
  // path is wasteful for huge tenants; batch into single-page searches.
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
    8
  );

  // Build the per-item report.
  const byItem = new Map<string, DatasourceMissingReport>();
  for (const p of pending) {
    let broken = false;
    if (p.datasource.startsWith("query:") || p.datasource.startsWith("local:")) {
      broken = true; // user opted in to reporting
    } else if (p.datasource.startsWith("/")) {
      broken = pathExists.get(p.datasource) === false;
    } else {
      const norm = normalizeItemId(p.datasource);
      if (norm.length === 32) broken = idExists.get(norm) === false;
    }
    if (!broken) continue;
    const existing = byItem.get(p.itemId);
    const entry = {
      fieldName: p.fieldName,
      renderingId: p.renderingId,
      datasource: p.datasource,
    };
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
    extra: { root, limit, scannedCount: scanned.length },
  });

  return reports;
};
