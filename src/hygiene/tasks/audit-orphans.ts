import { type HygieneCommonOptions, printReport, resolveTenant, toLogger } from "./shared";

export interface AuditOrphansOptions extends HygieneCommonOptions {
  /**
   * Page size for the archive listing. Default 100 (Authoring API
   * default). Higher values reduce request count for large archives.
   */
  pageSize?: number;
  /** Cap on the number of archived items returned. Default 1000. */
  limit?: number;
  /**
   * Override the archive name. Defaults to undefined, which means "all
   * archives" on the Authoring API.
   */
  archiveName?: string;
}

export interface OrphanReport {
  archivalId: string;
  itemId: string;
  name: string;
  originalLocation: string;
  archivedBy: string | null;
  archivedDate: string | null;
}

/**
 * List orphan items — i.e., items in the Sitecore archive (recycle bin).
 *
 * **XM Cloud reality check.** The dotnet `Sitecore.DevEx`
 * `clean-orphan-items` operation targeted SQL-layer orphans (items in
 * the master DB whose `ParentID` referenced a nonexistent parent).
 * That state isn't reachable through the XM Cloud Authoring API: the
 * GraphQL schema enforces parent integrity on every mutation, and
 * delete cascades from parent → children, so a "missing parent"
 * orphan can't be produced through normal use.
 *
 * What XM Cloud *does* expose is the archive (recycle bin). When an
 * operator deletes an item via XM Cloud UIs or via `deleteItem(input:
 * { permanently: false })`, it moves to the archive — visible only via
 * the `archivedItems` query. This is the closest analogue to
 * "orphaned" content on XM Cloud and is what an operator would mean by
 * "find items I can clean up."
 *
 * For genuine missing-parent items (extremely rare on XM Cloud, but
 * possible in disaster-recovery scenarios), a follow-up command could
 * walk the tree via `getChildren` and flag dangling refs — not in
 * this PR's scope.
 */
export const runAuditOrphans = async (options: AuditOrphansOptions): Promise<OrphanReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  const pageSize = options.pageSize ?? 100;
  const limit = options.limit ?? 1000;

  const archived: OrphanReport[] = [];
  let pageIndex = 0;
  while (archived.length < limit) {
    const page = await client.listArchivedItems({
      archiveName: options.archiveName,
      pageIndex,
      pageSize,
    });
    if (page.length === 0) break;
    for (const item of page) {
      if (archived.length >= limit) break;
      archived.push({
        archivalId: item.archivalId,
        itemId: item.itemId,
        name: item.name,
        originalLocation: item.originalLocation,
        archivedBy: item.archivedBy,
        archivedDate: item.archivedDate,
      });
    }
    if (page.length < pageSize) break;
    pageIndex += 1;
  }

  archived.sort((a, b) => {
    const aDate = a.archivedDate ?? "";
    const bDate = b.archivedDate ?? "";
    return bDate.localeCompare(aDate);
  });

  printReport({
    logger,
    command: "audit.orphans.list",
    envName,
    results: archived,
    summary:
      archived.length === 0
        ? "Archive is empty — no orphan items."
        : `${archived.length} archived item${archived.length === 1 ? "" : "s"}.`,
    formatLine: (r) =>
      `${r.name} from ${r.originalLocation}${r.archivedDate ? ` (${r.archivedDate.slice(0, 10)} by ${r.archivedBy ?? "?"})` : ""}`,
    extra: { archiveName: options.archiveName ?? null, limit },
    options,
  });

  return archived;
};
