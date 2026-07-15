import { describe, expect, it } from "vitest";
import { colorSchemeEnum } from "../../../example/recipes/color-scheme.recipe";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import { defaultPageDesignRecipe } from "../../../example/recipes/default-page-design.recipe";
import { standardFooterRecipe } from "../../../example/recipes/standard-footer.recipe";
import { standardHeaderRecipe } from "../../../example/recipes/standard-header.recipe";
import { FRONT_AGGREGATE_HANDLES, TAIL_AGGREGATE_HANDLES } from "../../../src/recipe/compile";
import {
  AVAILABLE_RENDERINGS_AGGREGATE_HANDLE,
  SHARED_DATA_FOLDERS_AGGREGATE_HANDLE,
} from "../../../src/recipe/compile/aggregates";
import {
  extractRecipeDependencies,
  RECIPE_APPLY_RANK,
  stableTopologicalSortWithinRanks,
} from "../../../src/recipe/compile/ordering";
import type { Recipe } from "../../../src/recipe/schema/recipe";

/**
 * `recipe list` emits
 *   stableTopologicalSortWithinRanks(recipes).map(r => ({ handle, kind }))
 * as JSON. The orchestrator's batched `recipe_sync` workflow consumes that
 * to partition the set into dependency-safe push batches, so BOTH the apply
 * ordering and the `{ handle, kind }` shape are load-bearing — that's what
 * this locks down.
 */
describe("recipe list — apply-order manifest", () => {
  // Deliberately supplied out of apply order.
  const set: readonly Recipe[] = [
    defaultPageDesignRecipe,
    colorSchemeEnum,
    ctaButtonRecipe,
    standardFooterRecipe,
    standardHeaderRecipe,
  ];

  const entries = stableTopologicalSortWithinRanks(set).map((recipe) => ({
    handle: recipe.handle,
    kind: recipe.kind,
  }));
  const order = entries.map((entry) => entry.handle);
  const indexOf = (handle: string) => order.indexOf(handle);

  it("preserves the whole set as { handle, kind }", () => {
    expect(entries).toHaveLength(set.length);
    expect(entries).toContainEqual({
      handle: "color-scheme@1",
      kind: "enumeration",
    });
    expect(entries).toContainEqual({
      handle: "cta-button@1",
      kind: "component-template",
    });
    expect(entries).toContainEqual({
      handle: "default-page-design@1",
      kind: "page-design",
    });
  });

  it("orders a composed partial-design before the page-design that references it", () => {
    // default-page-design@1 lists partials [standard-header@1, standard-footer@1];
    // the page design must apply AFTER both — the guarantee batching relies on.
    expect(indexOf("standard-header@1")).toBeLessThan(indexOf("default-page-design@1"));
    expect(indexOf("standard-footer@1")).toBeLessThan(indexOf("default-page-design@1"));
  });

  it("emits the dependency edges the topo-sort schedules by", () => {
    // `list --json` includes `dependsOn` per recipe — the SAME edges the
    // sequential apply order derives from, so a driver can schedule
    // independent same-rank recipes as parallel waves. The page design's
    // deps must name the partials it composes.
    const deps = extractRecipeDependencies(defaultPageDesignRecipe);
    expect(deps).toContain("standard-header@1");
    expect(deps).toContain("standard-footer@1");
  });

  it("exposes a rank for every recipe kind in the set", () => {
    for (const recipe of set) {
      expect(RECIPE_APPLY_RANK[recipe.kind]).toBeTypeOf("number");
    }
  });
});

/**
 * Page-tree nesting edges: pages all share one apply rank and carry no
 * handle reference to each other, so a page nested under another page's
 * `itemPath` (the wildcard detail-page pattern — an item literally named
 * `*` under a sibling page recipe) orders by itemPath ancestry instead.
 * Without the edge, a child that executes first makes `ensurePathExists`
 * auto-materialise the parent segment as a generic Folder, which the
 * parent page's own CreateItem (CreateOnly) can never repair.
 */
describe("apply ordering — page-tree nesting via itemPath", () => {
  const page = (handle: string, name: string, itemPath: string): Recipe => ({
    kind: "page",
    schemaVersion: "1",
    handle,
    name,
    displayName: name,
    template: "article-page@1",
    itemPath,
    fields: {},
  });

  const parentPage = page("cocktails@1", "Cocktails", "/sitecore/content/{site}/Home/Cocktails");
  const wildcardChild = page("cocktail-detail@1", "*", "/sitecore/content/{site}/Home/Cocktails/*");

  it("orders a wildcard child page after its ancestor page even when supplied first", () => {
    const order = stableTopologicalSortWithinRanks([wildcardChild, parentPage]).map(
      (recipe) => recipe.handle
    );
    expect(order).toEqual(["cocktails@1", "cocktail-detail@1"]);
  });

  it("emits the itemPath-ancestry edge in dependsOn when the set is passed", () => {
    expect(extractRecipeDependencies(wildcardChild, [wildcardChild, parentPage])).toContain(
      "cocktails@1"
    );
    // The ancestor gains no reverse edge — nesting is child → parent only.
    expect(extractRecipeDependencies(parentPage, [wildcardChild, parentPage])).not.toContain(
      "cocktail-detail@1"
    );
  });

  it("adds no edge between path-unrelated pages", () => {
    const sibling = page("about@1", "About", "/sitecore/content/{site}/Home/About");
    const deps = extractRecipeDependencies(sibling, [sibling, parentPage, wildcardChild]);
    // The page's template reference remains; no page-nesting edges appear.
    expect(deps).toEqual(["article-page@1"]);
  });
});

/**
 * The aggregate handle inventory `recipe list --json` emits so a batch
 * driver knows which synthetic IRs its `--handles`-scoped pushes drop:
 * `pre` rides with the first chunk (shared Data Folder templates must
 * exist before per-recipe items reference them), `post` runs once after
 * all chunks. Membership must track the aggregate constants — a new
 * aggregate that isn't in either list would silently vanish from every
 * batched install (the field failure this inventory exists to prevent).
 */
describe("recipe list — aggregate handle inventory", () => {
  it("front and tail inventories are disjoint, __name__-shaped, and cover the known aggregates", () => {
    const all = [...FRONT_AGGREGATE_HANDLES, ...TAIL_AGGREGATE_HANDLES];
    expect(new Set(all).size).toBe(all.length);
    for (const handle of all) {
      expect(handle).toMatch(/^__.+__$/);
    }
    expect(FRONT_AGGREGATE_HANDLES).toContain(SHARED_DATA_FOLDERS_AGGREGATE_HANDLE);
    expect(TAIL_AGGREGATE_HANDLES).toContain(AVAILABLE_RENDERINGS_AGGREGATE_HANDLE);
    // The orchestrator (demo-orchestrator scai-shared/recipe-batches.ts)
    // mirrors this inventory until it consumes `recipe list --json`'s
    // `aggregates` field — 1 front + 7 tail as of this writing.
    expect(FRONT_AGGREGATE_HANDLES).toHaveLength(1);
    expect(TAIL_AGGREGATE_HANDLES).toHaveLength(7);
  });
});
