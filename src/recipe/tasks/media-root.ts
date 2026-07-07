import type { DiscoveredSite } from "@/authoring";
import type { Logger } from "@/shared/logger";

/**
 * Align the site-scoped media-library root with the folder the XM Cloud
 * Sites API actually scaffolded for the site.
 *
 * The derived root is `/sitecore/media library/Project/<collection>/<site>`
 * (the site's machine name, e.g. `duke-energy`) — but the Sites API
 * scaffolds the site's media folder under the site's DISPLAY name (e.g.
 * `Duke Energy`). Left unaligned, recipe pushes create a parallel
 * slug-named folder beside the scaffolded one and the media library
 * splits across two trees.
 *
 * Resolution (best-effort, fail-open to the configured root):
 *   1. An explicit `--media-library-root` flag is used verbatim — never
 *      touched here (callers pass it through without calling this).
 *   2. Only roots whose leaf matches the site name are candidates for
 *      alignment — an operator-customized root is left alone.
 *   3. The site's display name comes from site discovery; when a folder
 *      named after it EXISTS in the media library, it wins (that's the
 *      scaffolded folder Pages-authored uploads already land in). When
 *      it doesn't exist, the configured root stands and is created on
 *      demand exactly as before.
 */
export const alignMediaLibraryRootWithSite = async (params: {
  /** Configured/derived root (env profile `recipeRoots.mediaLibrary`). */
  configuredRoot: string | undefined;
  /** Explicit `--media-library-root` flag — used verbatim when set. */
  explicitFlag?: string | undefined;
  /** Site machine name from the env profile (`site`). */
  site: string | undefined;
  /** Site discovery — scai's `discoverSites`, injected for testability. */
  discover: () => Promise<DiscoveredSite[]>;
  /** Batched existence lookup — the authoring client's `getItemsByPaths`. */
  getItemsByPaths: (paths: readonly string[]) => Promise<Map<string, unknown | null>>;
  logger: Pick<Logger, "info" | "debug">;
}): Promise<string | undefined> => {
  const { configuredRoot, site } = params;
  if (params.explicitFlag) return params.explicitFlag;
  if (!configuredRoot || !site) return configuredRoot;

  const root = configuredRoot.replace(/\/+$/, "");
  const lastSlash = root.lastIndexOf("/");
  if (lastSlash <= 0) return configuredRoot;
  const parent = root.slice(0, lastSlash);
  const leaf = root.slice(lastSlash + 1);

  // Only the derived site-scoped shape is aligned; a custom leaf means
  // the operator chose the folder deliberately.
  if (slugify(leaf) !== slugify(site)) return configuredRoot;

  try {
    const sites = await params.discover();
    const match = sites.find((s) => s.name === site || slugify(s.name) === slugify(site));
    const displayName = match?.displayName?.trim();
    // No display name, or it IS the leaf — nothing to align.
    if (!displayName || displayName === leaf) return configuredRoot;

    const scaffolded = `${parent}/${displayName}`;
    const found = await params.getItemsByPaths([scaffolded]);
    if (found.get(scaffolded)) {
      params.logger.info(
        `media-library root: using the site's scaffolded folder '${scaffolded}' (display name) instead of '${root}' so recipe media and Pages-authored media share one tree.`
      );
      return scaffolded;
    }
    return configuredRoot;
  } catch (err) {
    params.logger.debug?.(
      `media-library root alignment skipped (${err instanceof Error ? err.message : String(err)}); using '${root}'.`
    );
    return configuredRoot;
  }
};

/** Case/space-insensitive slug compare key (`Duke Energy` ≍ `duke-energy`). */
const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
