import { describe, expect, it } from "vitest";
import { colorSchemeEnum } from "../../../example/recipes/color-scheme.recipe";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import { defaultPageDesignRecipe } from "../../../example/recipes/default-page-design.recipe";
import { standardFooterRecipe } from "../../../example/recipes/standard-footer.recipe";
import { standardHeaderRecipe } from "../../../example/recipes/standard-header.recipe";
import { stableTopologicalSortWithinRanks } from "../../../src/recipe/compile/ordering";
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
});
