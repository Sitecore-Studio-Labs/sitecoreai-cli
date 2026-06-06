import { createScaiError } from "@/shared/errors";
import { type OperationIr } from "../ir/operations";
import { type DictionaryRecipe, DictionaryRecipeSchema } from "../schema/recipe";
import { type CompileContext } from "./shared";

/**
 * Compile a `DictionaryRecipe` to an Operation IR.
 *
 * **Pending the next commit (Tasks 2 + 3 + 4 in the dictionary
 * milestone plan).** The schema mirror (this commit, Task 1) lands
 * `DictionaryRecipe`, `siteRole`, and `SiteTemplate.dictionaries`
 * refs; the IR emission, cross-recipe validation rules, and tests
 * follow in the next commit. Keep this stub minimal so the discriminated
 * `compileRecipe` dispatcher stays exhaustive and the codebase compiles
 * cleanly between the schema mirror and the implementation.
 */
export function compileDictionaryRecipe(
  input: DictionaryRecipe,
  context: CompileContext
): OperationIr {
  void context;
  const recipe = DictionaryRecipeSchema.parse(input);
  throw createScaiError(
    `compileDictionaryRecipe is pending — schema mirror has landed (Task 1) but the IR emission ships in the next commit (Tasks 2 + 3 + 4). DictionaryRecipe '${recipe.handle}' cannot be compiled yet.`,
    "UNKNOWN"
  );
}
