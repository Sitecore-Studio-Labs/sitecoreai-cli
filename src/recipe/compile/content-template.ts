import { type Operation, type OperationIr, OperationIrSchema } from "../ir/operations";
import { defaultPolicyForRecipe } from "../policy";
import { DEFAULT_ICON } from "../ir/sitecore-templates";
import { type ContentTemplateRecipe, ContentTemplateRecipeSchema } from "../schema/recipe";
import {
  emitDatasourceTemplate,
  ensureContentModelsGroupFolder,
  joinPath,
  type CompileContext,
} from "./shared";

/**
 * Compile a `ContentTemplateRecipe` to an Operation IR.
 *
 * Content templates are data-only: a Sitecore template + sections + fields
 * + standard values + back-fill. No rendering, no params, no variants.
 *
 * Path resolution:
 *   - With `contentModelsRoot` and `meta.tax.group` set →
 *     `<contentModelsRoot>/<group>/<name>` (group folder created
 *     idempotently as a CreateOnly op).
 *   - With `contentModelsRoot` and no group → `<contentModelsRoot>/<name>`.
 *   - Without `contentModelsRoot` → legacy `<templatesRoot>/<name>`.
 */
export function compileContentTemplateRecipe(
  input: ContentTemplateRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  const recipe = ContentTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];

  const group = recipe.meta?.tax?.group;
  let parentPath: string | undefined;
  let parentRefKey: string | undefined;
  if (context.contentModelsRoot) {
    if (group) {
      const groupRefKey = ensureContentModelsGroupFolder(
        operations,
        context,
        group,
        emittedFolders
      );
      parentPath = joinPath(context.contentModelsRoot, group);
      parentRefKey = groupRefKey;
    } else {
      parentPath = context.contentModelsRoot;
    }
  }

  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      insertOptions: recipe.insertOptions,
      ...(parentPath !== undefined && { parentPath }),
      ...(parentRefKey !== undefined && { parentRefKey }),
    },
    context,
    DEFAULT_ICON,
    defaultPolicyForRecipe(recipe.kind)
  );

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
