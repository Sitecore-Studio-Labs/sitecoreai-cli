import {
  type HygieneCommonOptions,
  computeContentHash,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface AuditDuplicatesOptions extends HygieneCommonOptions {
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  includeSystemFields?: boolean;
  language?: string;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  /**
   * Only flag groups with size >= `minGroupSize`. Default 2.
   */
  minGroupSize?: number;
}

export interface DuplicatesGroup {
  contentHash: string;
  count: number;
  members: Array<{
    itemId: string;
    path: string;
    templateName: string | null;
    language: string | null;
    createdDate: string | null;
    updatedDate: string | null;
  }>;
}

/**
 * Audit content for items with byte-identical authored content,
 * grouped by content hash. See `computeContentHash` for the hash
 * input policy (sorted fields, system fields excluded by default).
 */
export const runAuditDuplicates = async (
  options: AuditDuplicatesOptions
): Promise<DuplicatesGroup[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const minGroupSize = options.minGroupSize ?? 2;

  const { scanned, fieldsByItemId, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  const groups = new Map<string, DuplicatesGroup>();
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const hash = await computeContentHash(fields, {
      includeSystem: options.includeSystemFields,
    });
    if (!hash) continue;
    const existing = groups.get(hash);
    const member = {
      itemId: item.itemId,
      path: item.path,
      templateName: item.templateName,
      language: item.language,
      createdDate: item.createdDate,
      updatedDate: item.updatedDate,
    };
    if (existing) {
      existing.members.push(member);
      existing.count = existing.members.length;
    } else {
      groups.set(hash, { contentHash: hash, count: 1, members: [member] });
    }
  }

  const duplicates = Array.from(groups.values())
    .filter((g) => g.count >= minGroupSize)
    .sort((a, b) => b.count - a.count);

  await cache?.flush();

  printReport({
    logger,
    command: "audit.duplicates.list",
    envName,
    results: duplicates,
    summary: `Scanned ${scanned.length} items; ${duplicates.length} duplicate group${duplicates.length === 1 ? "" : "s"} (>= ${minGroupSize} members each).`,
    formatLine: (g) =>
      `[${g.contentHash}] ${g.count}× : ${g.members
        .slice(0, 3)
        .map((m) => m.path)
        .join(", ")}${g.count > 3 ? "…" : ""}`,
    extra: { root, scannedCount: scanned.length, minGroupSize },
    options,
  });

  return duplicates;
};
