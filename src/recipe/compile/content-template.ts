import { v5 as uuidv5 } from "uuid";
import { standardValuesId, workflowId } from "../items/guids";
import {
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import { DEFAULT_ICON } from "../ir/sitecore-templates";
import { type ContentTemplateRecipe, ContentTemplateRecipeSchema } from "../schema/recipe";
import {
  emitDatasourceTemplate,
  ensureContentModelsGroupFolder,
  joinPath,
  siteOf,
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

  const policy = defaultPolicyForRecipe(recipe.kind);
  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      insertOptions: recipe.insertOptions,
      ...(recipe.mediaLocation ? { mediaLocation: recipe.mediaLocation } : {}),
      ...(parentPath !== undefined && { parentPath }),
      ...(parentRefKey !== undefined && { parentRefKey }),
    },
    context,
    DEFAULT_ICON,
    policy
  );

  if (recipe.defaultWorkflow) {
    const site = siteOf(context);
    const svRefKey = standardValuesId(site, recipe.handle);
    operations.push({
      op: "SetField",
      policy,
      label: `content-template-default-workflow:${recipe.handle}`,
      itemRefKey: svRefKey,
      fieldId: deriveStandardFieldId(svRefKey, "__Default workflow"),
      fieldName: "__Default workflow",
      value: { kind: "ref-recipe", refKey: workflowId(recipe.defaultWorkflow) },
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Stable refKey for a Sitecore standard field on `itemRefKey`. See
 * `compile/content-item.ts` for the rationale — same shape, separate
 * declaration to keep the modules independent.
 */
const STANDARD_FIELD_REFKEY_NAMESPACE = uuidv5(
  "standard-field",
  "d6c28e9f-21f3-56ee-ada3-f2a947c3d475" // NAMESPACE_ROOT
);
const deriveStandardFieldId = (parentRefKey: string, fieldName: string): string =>
  uuidv5(`${parentRefKey}:${fieldName}`, STANDARD_FIELD_REFKEY_NAMESPACE);
