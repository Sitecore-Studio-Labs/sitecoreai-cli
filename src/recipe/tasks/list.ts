import { readRootConfiguration } from "@/config/root-config";
import { stableTopologicalSortWithinRanks } from "../compile/ordering";
import { loadRecipe } from "../io";
import { resolveRecipeInputs, toLogger, type RecipeCompileOptions } from "./shared";

/**
 * `scai provision recipe list` — pure-logic recipe discovery.
 *
 * Loads the recipe set (the same `.ts` / `.json` files `compile` and `push`
 * read), orders it by cross-recipe apply-rank (the exact order `push`
 * applies in — see `stableTopologicalSortWithinRanks`), and emits one
 * `{ handle, kind }` per recipe.
 *
 * No tenant contact and no compile-to-IR — this only reads local files, so
 * it's cheap and needs no environment credentials. Its purpose is to let a
 * driver (the orchestrator's batched `recipe_sync` workflow) partition the
 * set into dependency-safe push batches without re-deriving the recipe
 * graph itself: `kind` distinguishes the compile-time "floor" recipes
 * (`enumeration`, `component-section`, `design-parameters-template`,
 * `content-template`) — which every batch must carry so cross-refs resolve
 * — from the bulk (`component-template`, page items) that can be chunked.
 */
export const runRecipeList = async (options: RecipeCompileOptions): Promise<void> => {
  const logger = toLogger(options);
  const root = readRootConfiguration(options.config ?? process.cwd(), options.environmentName);

  const { files, source } = await resolveRecipeInputs(options, root);
  const recipes = await Promise.all(files.map((file) => loadRecipe(file)));
  const ordered = stableTopologicalSortWithinRanks(recipes);
  const entries = ordered.map((recipe) => ({
    handle: recipe.handle,
    kind: recipe.kind,
  }));

  if (logger.isJson()) {
    logger.json({
      command: "recipe.list",
      source,
      count: entries.length,
      recipes: entries,
    });
    return;
  }

  logger.info(
    `${entries.length} recipe${entries.length === 1 ? "" : "s"} in apply order:`,
    "green"
  );
  for (const entry of entries) {
    logger.info(`  ${entry.handle}  [${entry.kind}]`);
  }
};
