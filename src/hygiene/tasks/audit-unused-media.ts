import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  extractInternalRefs,
  extractMediaRefs,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";
import { MEDIA_LIBRARY_ROOT } from "../api/client";

export interface AuditUnusedMediaOptions extends HygieneCommonOptions {
  /**
   * Root of the media library to scan. Defaults to
   * `/sitecore/media library`. Override only for tenants that nest media
   * under a non-default location (rare on XM Cloud).
   */
  mediaRoot?: string;
  /**
   * Root under which references to media items are looked for. Defaults
   * to `/sitecore/content` — most refs come from rendered content. To
   * also include site definitions or design templates, broaden this
   * to `/sitecore`.
   */
  referenceRoot?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on the number of media items inspected. Default 5000. */
  mediaLimit?: number;
  /** Cap on the number of reference-side items inspected. Default 10000. */
  referenceLimit?: number;
  /** Batch size for item-fields lookups. Default 25. */
  batchSize?: number;
}

export interface UnusedMediaReport {
  itemId: string;
  path: string;
  templateName?: string | null;
  size?: number | null;
}

/**
 * Audit `/sitecore/media library` for media items that aren't referenced
 * by any content item.
 *
 * Strategy (two-pass scan, both via the search index):
 *
 *   1. Enumerate every media item under `--media-root`. These become
 *      candidates for "unused."
 *   2. Enumerate every non-media item under `--reference-root` (default
 *      `/sitecore/content`). For each, fetch all fields in batches and
 *      run `extractMediaRefs` over field values. The output is the set
 *      of media itemIds that *are* referenced.
 *   3. Subtract: candidates minus referenced = unused media.
 *
 * Notes:
 *   - The Authoring API exposes neither a "where-used" query nor a link
 *     database read surface. This is the cheapest correct approach.
 *   - False positives are possible when a media item is referenced from
 *     content stored OUTSIDE `--reference-root` (e.g. presentation
 *     definitions under `/sitecore/layout` or rendering parameters in
 *     non-content trees). Operators with mixed content/layout media
 *     references should re-run with `--reference-root /sitecore`.
 *   - References from RichText `<link linktype="media">` tags and Image
 *     field XML (`<image mediaid="...">`) are recognised; bare GUIDs in
 *     Multilist fields targeting media are also captured by
 *     `extractInternalRefs` and filtered against the candidates set.
 */
export const runAuditUnusedMedia = async (
  options: AuditUnusedMediaOptions
): Promise<UnusedMediaReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const mediaRoot = options.mediaRoot ?? MEDIA_LIBRARY_ROOT;
  const referenceRoot = options.referenceRoot ?? "/sitecore/content";
  const mediaLimit = options.mediaLimit ?? 5000;
  const referenceLimit = options.referenceLimit ?? 10000;
  const knobs = resolveHygieneKnobs(options);

  // Resolve roots → itemIds for `_path` filter.
  const resolveRootItemId = async (path: string): Promise<string | undefined> => {
    const r = await client.search({
      index: options.index,
      paging: { pageSize: 1 },
      searchStatement: {
        criteria: { field: "_fullpath", value: path.toLowerCase(), criteriaType: "EXACT" },
      },
    });
    return r.results[0]?.itemId;
  };

  const mediaRootId = await resolveRootItemId(mediaRoot);
  const referenceRootId = await resolveRootItemId(referenceRoot);

  if (!mediaRootId) {
    logger.warn(`Media root '${mediaRoot}' not found in index; scanning full master DB.`);
  }
  if (!referenceRootId) {
    logger.warn(`Reference root '${referenceRoot}' not found in index; scanning full master DB.`);
  }

  // Pass 1 — enumerate media item candidates (no fields needed).
  const candidates = new Map<string, UnusedMediaReport>();
  let mediaCount = 0;
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      ...(mediaRootId && { searchStatement: buildPathFilterStatement(mediaRootId) }),
    },
    100,
    knobs.pageParallelism
  )) {
    // The `_path` CONTAINS filter on `mediaRootId` already restricts the
    // result set to descendants of the media library. We do NOT add a
    // string-prefix path check here because the XM Cloud search index
    // returns *media paths* (e.g. "/default website/images/...") rather
    // than full content-tree paths for items under
    // `/sitecore/media library`. A `startsWith("/sitecore/media library/")`
    // check would reject every result. Skip the media-library root item
    // itself by itemId comparison — that's the only false positive.
    if (mediaRootId && normalizeItemId(r.itemId) === normalizeItemId(mediaRootId)) continue;
    const id = normalizeItemId(r.itemId);
    if (!candidates.has(id)) {
      candidates.set(id, {
        itemId: id,
        path: r.path,
        templateName: r.templateName ?? null,
      });
    }
    mediaCount += 1;
    if (mediaCount >= mediaLimit) break;
  }
  logger.verbose(`Pass 1: ${candidates.size} media-item candidates.`);

  // Pass 2 — enumerate reference-side items + fields via the perf-tuned helper.
  const {
    scanned: referenceItems,
    fieldsByItemId,
    cache,
  } = await scanItemsAndFields({
    client,
    envName,
    root: referenceRoot,
    logger,
    options: { ...options, limit: referenceLimit, includeSystem: false },
  });
  logger.verbose(`Pass 2: ${referenceItems.length} reference-side items inspected.`);

  const referenced = new Set<string>();
  for (const item of referenceItems) {
    if (isSystemPath(item.path)) continue;
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field.value) continue;
      for (const ref of extractMediaRefs(field.value)) referenced.add(ref);
      // Multilist/Treelist GUIDs that happen to point at media candidates.
      for (const ref of extractInternalRefs(field.value)) {
        if (candidates.has(ref)) referenced.add(ref);
      }
    }
  }
  logger.verbose(`Found ${referenced.size} distinct media refs across reference items.`);
  await cache?.flush();

  const unused: UnusedMediaReport[] = [];
  for (const [id, candidate] of candidates) {
    if (!referenced.has(id)) unused.push(candidate);
  }
  unused.sort((a, b) => a.path.localeCompare(b.path));

  printReport({
    logger,
    command: "audit.unused-media.list",
    envName,
    results: unused,
    summary: `Scanned ${candidates.size} media items, ${referenceItems.length} ref-side items; ${unused.length} unused.`,
    formatLine: (r) => `${r.path}${r.templateName ? ` (${r.templateName})` : ""}`,
    extra: {
      mediaRoot,
      referenceRoot,
      mediaScanned: candidates.size,
      referenceScanned: referenceItems.length,
    },
    options,
  });

  return unused;
};
