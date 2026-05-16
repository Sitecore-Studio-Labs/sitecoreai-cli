import { type OperationIr, OperationIrSchema } from "../ir/operations";
import { type PlaceholderRecipe, PlaceholderRecipeSchema } from "../schema/recipe";
import { type CompileContext } from "./shared";

/**
 * Compile a `PlaceholderRecipe` to an Operation IR.
 *
 * A standalone placeholder emits no ops on its own — a Placeholder
 * Settings item's `Allowed Controls` whitelist is cross-recipe by
 * nature (it unions this recipe's `allowedComponents` with every
 * component that names the same `key` in `placedIn`). A per-recipe
 * `SetField` would full-replace and clobber those contributions.
 *
 * So both halves of the hybrid model — standalone `PlaceholderRecipe`
 * and inline `ComponentTemplateRecipe.placeholders` — are materialised
 * by one cross-recipe aggregate, `buildPlaceholderSettingsAggregate` in
 * `compile.ts`, which emits one `CreateItem` + one `SetField(Allowed
 * Controls)` per unique placeholder key. This per-recipe compiler
 * returns an empty IR; use `compileRecipeSet`.
 *
 * Same pattern as `compileSectionDefinitionRecipe`. The recipe is still
 * parsed here so authors get schema feedback on a single-recipe compile.
 */
export function compilePlaceholderRecipe(
  input: PlaceholderRecipe,
  _context: CompileContext
): OperationIr {
  const recipe = PlaceholderRecipeSchema.parse(input);
  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations: [],
  });
}
