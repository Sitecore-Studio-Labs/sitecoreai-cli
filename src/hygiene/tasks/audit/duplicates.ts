import {
  type HygieneCommonOptions,
  computeContentHash,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";

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
  /**
   * Loosen the grouping key. Default key is
   * `(contentHash, templateId, parentPath)` so items that hash
   * identically only because their fields are all empty don't get
   * conflated across unrelated templates / parents. Set this to
   * `contentHash` only when you intentionally want to find cross-
   * template byte-equivalent content (e.g. asset re-use audits).
   */
  groupBy?: ReadonlyArray<"contentHash" | "templateId" | "parentPath">;
}

export interface DuplicatesGroup {
  contentHash: string;
  /** Template ID shared by every member in the group (or null). */
  templateId: string | null;
  /** Parent path shared by every member in the group. */
  parentPath: string | null;
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

const parentOfPath = (p: string): string => {
  const idx = p.lastIndexOf("/");
  return idx > 0 ? p.slice(0, idx) : "/";
};

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

  // Default group key tightens the dedup from "byte-identical content"
  // to "byte-identical content under the same template at the same
  // parent". Pre-2026 the key was just contentHash, which lumped
  // together empty Folder + empty Page items because their field-set
  // hashes collapse to the same digest. Override via --group-by to opt
  // back into the looser key when investigating cross-template reuse.
  const groupBy = new Set<"contentHash" | "templateId" | "parentPath">(
    options.groupBy ?? ["contentHash", "templateId", "parentPath"]
  );
  if (!groupBy.has("contentHash")) groupBy.add("contentHash");
  const groups = new Map<string, DuplicatesGroup>();
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const hash = await computeContentHash(fields, {
      includeSystem: options.includeSystemFields,
    });
    if (!hash) continue;
    const parentPath = parentOfPath(item.path);
    const keyParts = [
      hash,
      groupBy.has("templateId") ? (item.templateId ?? "no-tmpl") : "*",
      groupBy.has("parentPath") ? parentPath : "*",
    ];
    const key = keyParts.join("|");
    const existing = groups.get(key);
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
      groups.set(key, {
        contentHash: hash,
        templateId: groupBy.has("templateId") ? item.templateId : null,
        parentPath: groupBy.has("parentPath") ? parentPath : null,
        count: 1,
        members: [member],
      });
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
