/**
 * Sweeps orphan E2E artifacts left on the sandbox tenant by the
 * `site-template-picker.integration.test.ts` suite.
 *
 * The integration test's `afterAll` already cleans up its own site,
 * site-template, module root, uploaded media, and collection items in
 * normal runs. This script is the safety net for when `afterAll`
 * doesn't run (rate-limit cutoff mid-suite, crashed process, etc.).
 *
 * Replaces the two earlier scripts:
 *   - `_recon-cleanup-e2e.ts` (broader, blanket-deleted `Modules`
 *     parent + the `scai-e2e` and media-library `SiteTemplates`
 *     parents — no prefix guard)
 *   - `_recon-sweep-orphan-collections.ts` (narrow, only
 *     `E2eCollection*` under Settings/Project, with per-iteration
 *     prefix guard)
 *
 * Defensive contract:
 *   - Every `deleteItem` call site re-checks the candidate's `.name`
 *     starts with `E2e` and refuses + logs if not. Never trusts the
 *     upstream filter alone.
 *   - Never touches the four scanned parents themselves
 *     (Settings/Project, click-click-launch/Templates, .../Modules,
 *     media library/SiteTemplates), nor any non-E2e sibling
 *     (`click-click-launch`, `next-wave`, etc.).
 *   - Idempotent — a second run on a clean tenant logs "0 orphans"
 *     for each path and exits 0.
 *
 * Usage:
 *   RECIPE_TEST_ENV_PROFILE=TestDemo pnpm exec tsx \
 *     -r tsconfig-paths/register scripts/_recon-sweep-e2e-orphans.ts
 */
import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const E2E_PREFIX = "E2e";

const SCAN_PATHS = {
  collections: "/sitecore/system/Settings/Project",
  siteTemplates: "/sitecore/system/Settings/Project/click-click-launch/Templates",
  modules: "/sitecore/system/Settings/Project/click-click-launch/Templates/Modules",
  mediaThumbnails: "/sitecore/media library/SiteTemplates",
} as const;

interface SweepStats {
  scanned: number;
  deleted: number;
  refused: number;
  failed: number;
}

const main = async (): Promise<void> => {
  const profileName = process.env.RECIPE_TEST_ENV_PROFILE ?? process.argv[2] ?? "TestDemo";
  const { environment } = resolveEnvironment({
    environmentName: profileName,
    skipPolicy: true,
  });
  const authoring = createAuthoringClient({ environment });

  /**
   * Re-checks the candidate's name at the call site before issuing
   * a delete. Refuses (returns false) for anything that doesn't carry
   * the E2e prefix — defence in depth against a future filter refactor
   * letting non-test items through.
   */
  const safeDelete = async (
    label: string,
    candidate: { name: string; itemId: string; path?: string }
  ): Promise<"deleted" | "refused" | "failed"> => {
    if (!candidate.name.startsWith(E2E_PREFIX)) {
      console.error(
        `  [refused] ${label}: '${candidate.name}' does not start with '${E2E_PREFIX}' — not touching`
      );
      return "refused";
    }
    const loc = candidate.path ?? candidate.itemId;
    console.log(`  [delete]  ${label}: ${candidate.name} (${loc})`);
    try {
      await authoring.deleteItem({ itemId: candidate.itemId });
      console.log(`  [ok]      ${label}: ${candidate.name}`);
      return "deleted";
    } catch (e) {
      console.error(`  [failed]  ${label}: ${candidate.name} — ${(e as Error).message}`);
      return "failed";
    }
  };

  /**
   * Sweeps direct children of `parentPath` whose name starts with the
   * E2e prefix. Logs but does NOT delete the parent itself under any
   * circumstance.
   */
  const sweepDirectChildren = async (label: string, parentPath: string): Promise<SweepStats> => {
    const stats: SweepStats = { scanned: 0, deleted: 0, refused: 0, failed: 0 };
    console.log(`\n[scan] ${label} — ${parentPath}`);
    const parent = await authoring.getItem({ path: parentPath });
    if (!parent) {
      console.log(`  parent not found — nothing to do`);
      return stats;
    }
    const children = await authoring.getChildren({ itemId: parent.itemId });
    const orphans = children.filter((c) => c.name.startsWith(E2E_PREFIX));
    stats.scanned = orphans.length;
    console.log(`  found ${orphans.length} orphan(s) matching '${E2E_PREFIX}*'`);
    for (const orphan of orphans) {
      const result = await safeDelete(label, orphan);
      if (result === "deleted") stats.deleted += 1;
      else if (result === "refused") stats.refused += 1;
      else stats.failed += 1;
    }
    return stats;
  };

  const totals: SweepStats = { scanned: 0, deleted: 0, refused: 0, failed: 0 };
  const accumulate = (s: SweepStats): void => {
    totals.scanned += s.scanned;
    totals.deleted += s.deleted;
    totals.refused += s.refused;
    totals.failed += s.failed;
  };

  console.log(`Sweeping E2e orphans on env profile '${profileName}'`);

  // 1. Orphan SXA collection items under Settings/Project. The Sites
  //    API auto-creates one of these alongside the content-tree
  //    collection when `collectionName` is used; site delete does NOT
  //    cascade to it.
  accumulate(await sweepDirectChildren("collection", SCAN_PATHS.collections));

  // 2. Orphan SiteTemplate items under <siteTemplatesRoot>. Normally
  //    cascade-deleted with the test's afterAll site-template delete;
  //    a crashed run leaks them.
  accumulate(await sweepDirectChildren("site-template", SCAN_PATHS.siteTemplates));

  // 3. Orphan Module roots under <siteTemplatesRoot>/Modules. The
  //    Module folder has tenant-infrastructure siblings
  //    (`Foundation Headless Site Setup`, etc.) — only delete
  //    E2e-prefixed children. Server-side cascade removes their
  //    setup-action children, so we don't need to recurse.
  accumulate(await sweepDirectChildren("module-root", SCAN_PATHS.modules));

  // 4. Orphan uploaded thumbnails in the media library. The
  //    `SiteTemplates` folder is shared with tenant thumbnails —
  //    only delete E2e-prefixed children.
  accumulate(await sweepDirectChildren("media-thumbnail", SCAN_PATHS.mediaThumbnails));

  console.log(
    `\n[summary] scanned=${totals.scanned} deleted=${totals.deleted} refused=${totals.refused} failed=${totals.failed}`
  );

  if (totals.failed > 0) {
    process.exit(1);
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
