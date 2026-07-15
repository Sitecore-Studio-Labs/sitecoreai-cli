/**
 * Cross-recipe apply-ordering for `compileRecipeSet`.
 *
 * Two layers:
 *   - **Coarse rank** (`RECIPE_APPLY_RANK`) orders ACROSS kinds — a page
 *     after its page template, a site after its site template.
 *   - **Intra-rank topo-sort** (`stableTopologicalSortWithinRanks`)
 *     orders WITHIN a rank by each recipe's outbound cross-recipe handle
 *     references, so a referencing recipe applies after its referent
 *     even when file-glob order would put it first.
 *
 * The reference inventory comes from the shared `recipeReferences()`
 * accessor — the same one the cross-recipe validator consumes — so the
 * two stay in lockstep automatically (a new reference site added there
 * is picked up by BOTH the topo-sort and validation without a second
 * edit here).
 */
import type { Recipe } from "../schema/recipe";
import { recipeReferences } from "../references";

/**
 * Cross-recipe apply-ordering rank, by recipe kind. `compileRecipeSet`
 * stably sorts per-recipe IRs by this rank so every recipe is applied
 * after the definitions it references:
 *
 *   0  definitions — templates, sections, enums, workflows: referenced
 *      by everything, reference nothing cross-recipe forward.
 *   1  content items + placeholders — reference rank-0 templates.
 *   2  partial designs — place components, bind shared content items.
 *   3  page designs + pages — reference page templates, partials,
 *      content items.
 *   4  site templates — reference page templates + page designs.
 *   5  sites — instance a site template, point at an initial page.
 *
 * The rank is coarse — it orders ACROSS kinds, not within. Intra-rank
 * forward references (e.g. one component's `insertOptions` naming
 * another) still rely on the executor's `crossRecipeRefs` path seeding.
 */
export const RECIPE_APPLY_RANK: Record<Recipe["kind"], number> = {
  "component-section": 0,
  "component-template": 0,
  "content-template": 0,
  "page-template": 0,
  "design-parameters-template": 0,
  enumeration: 0,
  workflow: 0,
  "webhook-authorization": 0,
  "content-item": 1,
  placeholder: 1,
  // Brand variants attach to existing component-templates (rank 0).
  // Rank 1 keeps them after the canonical in the same set — and, when
  // installed standalone (the common case), still respects layering
  // against any composition-level recipes shipped alongside.
  variant: 1,
  "partial-design": 2,
  "page-design": 3,
  page: 3,
  "site-template": 4,
  // Sites must materialise before dictionaries — a DictionaryRecipe's
  // items land under `<site>/Dictionary/<name>` and the site's content
  // tree has to exist first.
  site: 5,
  dictionary: 6,
};

/** Normalise an authored `itemPath` for verbatim comparison. */
const trimTrailingSlashes = (path: string): string => path.replace(/\/+$/, "");

/**
 * Page-tree nesting edges derived from `itemPath` — a page whose
 * `itemPath` nests under another in-set page's `itemPath` (e.g. a
 * wildcard detail page `/…/Home/Cocktails/*` under `/…/Home/Cocktails`)
 * must apply AFTER that ancestor page. Pages share one apply rank and
 * carry no handle reference to each other, so without this edge the
 * child can execute first — and the executor's `ensurePathExists` then
 * auto-materialises the missing parent segment as a generic `Folder`,
 * which the ancestor page's own `CreateItem` can never repair (the
 * already-exists fallback returns the folder's itemId, and `CreateOnly`
 * policy never rewrites its template).
 *
 * Paths are compared verbatim — the `{site}` placeholder included — so
 * the edge forms exactly when both recipes author the same path shape,
 * which is the case where the ancestor page owns the child's parent
 * segment.
 */
const pageAncestorDependencies = (recipe: Recipe, set: readonly Recipe[]): string[] => {
  if (recipe.kind !== "page" || !recipe.itemPath) return [];
  const handleByPath = new Map<string, string>();
  for (const other of set) {
    if (other.kind === "page" && other.itemPath && other.handle !== recipe.handle) {
      handleByPath.set(trimTrailingSlashes(other.itemPath), other.handle);
    }
  }
  if (handleByPath.size === 0) return [];
  const deps: string[] = [];
  let path = trimTrailingSlashes(recipe.itemPath);
  for (let cut = path.lastIndexOf("/"); cut > 0; cut = path.lastIndexOf("/")) {
    path = path.slice(0, cut);
    const handle = handleByPath.get(path);
    if (handle) deps.push(handle);
  }
  return deps;
};

/**
 * The set of in-set cross-recipe dependency handles for a single recipe.
 *
 * Thin wrapper over the shared `recipeReferences()` inventory — pulls
 * the `handle` of every outbound reference (validated or topo-only),
 * de-dupes, and drops self-references. (Validation runs separately and
 * asserts every handle resolves to an extant recipe of the right kind;
 * this extractor assumes input has already been validated and doesn't
 * re-check.)
 *
 * When the surrounding recipe `set` is provided, page-tree nesting edges
 * derived from `itemPath` are included too (see
 * `pageAncestorDependencies`) — a page nested under another page's path
 * depends on that ancestor even though no handle reference exists.
 *
 * Exported for `recipe list --json`: the emitted `dependsOn` edges are
 * exactly the edges this module's topo-sort schedules by, so a batch
 * driver partitioning the set into parallel waves works from the same
 * graph the sequential apply order derives from.
 */
export const extractRecipeDependencies = (
  recipe: Recipe,
  set?: readonly Recipe[]
): readonly string[] => {
  const deps = new Set<string>();
  for (const ref of recipeReferences(recipe)) {
    if (ref.handle && ref.handle !== recipe.handle) deps.add(ref.handle);
  }
  if (set) {
    for (const handle of pageAncestorDependencies(recipe, set)) deps.add(handle);
  }
  return [...deps];
};

/** Bucket recipes by apply-rank, preserving input order within each bucket. */
const groupByRank = (recipes: readonly Recipe[]): Map<number, Recipe[]> => {
  const groups = new Map<number, Recipe[]>();
  for (const r of recipes) {
    const rank = RECIPE_APPLY_RANK[r.kind];
    let bucket = groups.get(rank);
    if (!bucket) {
      bucket = [];
      groups.set(rank, bucket);
    }
    bucket.push(r);
  }
  return groups;
};

/**
 * Topologically sort one rank-group by intra-group cross-recipe
 * dependencies, tie-broken by original input index. Kahn's algorithm;
 * cycle survivors (not expected — `validateRecipeSet` catches them) are
 * appended in input order so push still runs deterministically rather
 * than throwing here.
 */
const topoSortGroup = (group: readonly Recipe[]): Recipe[] => {
  if (group.length <= 1) return [...group];

  const handleToIndex = new Map<string, number>();
  group.forEach((r, idx) => handleToIndex.set(r.handle, idx));
  const inDegree = new Array<number>(group.length).fill(0);
  const adjacency: number[][] = group.map(() => []);
  for (let i = 0; i < group.length; i++) {
    // Pass the group so page-tree nesting edges (itemPath ancestry —
    // pages all share one rank, so any in-set ancestor page is in this
    // group) participate in the sort alongside handle references.
    for (const depHandle of extractRecipeDependencies(group[i], group)) {
      const depIdx = handleToIndex.get(depHandle);
      if (depIdx === undefined || depIdx === i) continue;
      adjacency[depIdx].push(i);
      inDegree[i]++;
    }
  }

  const ready: number[] = [];
  for (let i = 0; i < group.length; i++) if (inDegree[i] === 0) ready.push(i);
  const sorted: Recipe[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const idx = ready.shift()!;
    sorted.push(group[idx]);
    for (const next of adjacency[idx]) {
      inDegree[next]--;
      if (inDegree[next] === 0) ready.push(next);
    }
  }
  // Defensive: append any cycle survivors in input order.
  if (sorted.length < group.length) {
    const placed = new Set(sorted.map((r) => r.handle));
    for (const r of group) if (!placed.has(r.handle)) sorted.push(r);
  }
  return sorted;
};

/**
 * Order recipes by apply-rank, then topologically by intra-rank
 * cross-recipe dependencies. Producer recipes push before the recipes
 * that reference them.
 *
 * The sort is stable: unrelated recipes keep their file-glob order, and
 * cross-rank dependencies are handled by the coarse rank — within-rank
 * topology only matters when two recipes of the same kind reference each
 * other (e.g. a component-template referencing a content-template at
 * rank 0).
 */
export const stableTopologicalSortWithinRanks = (recipes: readonly Recipe[]): readonly Recipe[] => {
  const groups = groupByRank(recipes);
  const out: Recipe[] = [];
  for (const rank of [...groups.keys()].sort((a, b) => a - b)) {
    out.push(...topoSortGroup(groups.get(rank)!));
  }
  return out;
};
