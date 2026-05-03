import { type OperationIr, OperationIrSchema } from "../ir/operations";
import { type SectionDefinitionRecipe, SectionDefinitionRecipeSchema } from "../schema/recipe";
import { type CompileContext } from "./shared";

/**
 * Compile a `SectionDefinitionRecipe` to an Operation IR.
 *
 * Section definitions are typically pre-existing tenant scaffolding —
 * the compiler does NOT emit a CreateItem op for them. Instead, the
 * recipe's `sitePath` is registered as a cross-recipe ref so the
 * executor's `seedCrossRecipeRefs` can resolve the existing item's
 * Sitecore itemId at apply time. For now this compiler returns an
 * empty IR; downstream `compileRecipeSet` handles the cross-recipe
 * ref pre-seeding via `extractCrossRecipeSeeds()` (separate plan).
 *
 * The recipe is still validated here so authors get schema feedback.
 */
export function compileSectionDefinitionRecipe(
  input: SectionDefinitionRecipe,
  _context: CompileContext
): OperationIr {
  const recipe = SectionDefinitionRecipeSchema.parse(input);
  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations: [],
  });
}
