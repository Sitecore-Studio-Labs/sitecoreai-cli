import { readRootConfiguration } from "@/config/root-config";
import { FRONT_AGGREGATE_HANDLES, TAIL_AGGREGATE_HANDLES } from "../compile";
import { collectRecipeLanguages } from "../compile/languages";
import {
  extractRecipeDependencies,
  RECIPE_APPLY_RANK,
  stableTopologicalSortWithinRanks,
} from "../compile/ordering";
import { loadRecipe } from "../io";
import { resolveRecipeInputs, toLogger, type RecipeCompileOptions } from "./shared";

/**
 * `scai provision recipe list` — pure-logic recipe discovery.
 *
 * Loads the recipe set (the same `.ts` / `.json` files `compile` and `push`
 * read), orders it by cross-recipe apply-rank (the exact order `push`
 * applies in — see `stableTopologicalSortWithinRanks`), and emits one
 * `{ handle, kind, rank, dependsOn, languages }` per recipe plus the
 * set-wide `languages` union.
 *
 * No tenant contact and no compile-to-IR — this only reads local files, so
 * it's cheap and needs no environment credentials. Its purpose is to let a
 * driver (the orchestrator's batched `recipe_sync` workflow) partition the
 * set into dependency-safe push batches without re-deriving the recipe
 * graph itself:
 *
 *   - `rank` is the coarse apply tier (`RECIPE_APPLY_RANK`) — templates
 *     before content, content before designs, designs before sites.
 *   - `dependsOn` is the recipe's in-set cross-recipe handle references —
 *     the SAME edges the sequential apply order topo-sorts by, so a driver
 *     can schedule independent same-rank recipes as parallel waves: a
 *     recipe may push concurrently with anything that is neither an
 *     ancestor nor a descendant in (rank, dependsOn).
 *   - `languages` is the recipe's authored locale inventory (verbatim
 *     codes — base languages keep their `--languages` expansion
 *     semantics), letting the driver scope localize passes to exactly the
 *     authored surface instead of unscoped (= every registered locale).
 *
 * NOTE for drivers: `--handles`-scoped pushes drop the synthetic
 * cross-recipe aggregate IRs (`__available-renderings__` & co) — after all
 * batches, run one `recipe push --aggregates-only` step to land the
 * shared-item writes exactly once.
 */
export const runRecipeList = async (options: RecipeCompileOptions): Promise<void> => {
  const logger = toLogger(options);
  const root = readRootConfiguration(options.config ?? process.cwd(), options.environmentName);

  const { files, source } = await resolveRecipeInputs(options, root);
  const recipes = await Promise.all(files.map((file) => loadRecipe(file)));
  const ordered = stableTopologicalSortWithinRanks(recipes);
  const inSet = new Set(ordered.map((recipe) => recipe.handle));
  const entries = ordered.map((recipe) => ({
    handle: recipe.handle,
    kind: recipe.kind,
    rank: RECIPE_APPLY_RANK[recipe.kind],
    // In-set edges only — a reference to a handle outside the loaded set
    // can't be scheduled and already resolves against the tenant. The
    // set is passed so page-tree nesting edges (itemPath ancestry) ride
    // along — the same edges the apply-order topo-sort schedules by.
    dependsOn: extractRecipeDependencies(recipe, ordered).filter((handle) => inSet.has(handle)),
    languages: collectRecipeLanguages(recipe),
  }));

  if (logger.isJson()) {
    const languages = [...new Set(entries.flatMap((entry) => entry.languages))].sort((a, b) =>
      a.localeCompare(b)
    );
    logger.json({
      command: "recipe.list",
      source,
      count: entries.length,
      languages,
      // The synthetic aggregate handles a `--handles`-scoped push drops:
      // `pre` must ride with the driver's first chunk, `post` runs once
      // after every chunk (or via `recipe push --aggregates-only`).
      aggregates: {
        pre: [...FRONT_AGGREGATE_HANDLES],
        post: [...TAIL_AGGREGATE_HANDLES],
      },
      recipes: entries,
    });
    return;
  }

  logger.info(
    `${entries.length} recipe${entries.length === 1 ? "" : "s"} in apply order:`,
    "green"
  );
  for (const entry of entries) {
    const deps = entry.dependsOn.length > 0 ? `  ← ${entry.dependsOn.join(", ")}` : "";
    logger.info(`  ${entry.handle}  [${entry.kind}]${deps}`);
  }
};
