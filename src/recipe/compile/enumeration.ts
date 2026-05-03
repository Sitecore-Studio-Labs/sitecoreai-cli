import { enumerationFolderId, enumValueId } from "../guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../policy";
import { createCliError } from "../../shared/errors";
import { SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { type EnumerationRecipe, EnumerationRecipeSchema } from "../schema/recipe";
import {
  ENUMERATION_FOLDER_ICON,
  joinPath,
  sharedField,
  siteOf,
  versionedField,
  type CompileContext,
} from "./shared";

/**
 * Compile an `EnumerationRecipe` to an Operation IR.
 *
 * Emits one CreateItem op for the enumeration's root folder
 * (`<enumerationsRoot>/<recipe.name>`) and one CreateItem op per
 * declared value (parented under the folder). Both the folder and the
 * value items conform to Sitecore's generic Folder template — Sitecore's
 * Droplink picker enumerates the folder's children at edit time without
 * needing a specialised template.
 *
 * Refkeys:
 *   - Folder:  `enumerationFolderId(site, recipe.handle)` — site-scoped
 *     so cross-site pushes don't collide.
 *   - Values:  `enumValueId(folderRefKey, value.name)` — value-name keyed
 *     under the folder. Renaming a value (`primary` → `accent`) emits a
 *     different GUID; consuming fields whose default referenced the old
 *     name end up orphaned. Author error.
 *
 * Throws `INPUT_INVALID` when `context.enumerationsRoot` is unset —
 * mirrors how `compilePartialDesignRecipe` validates `partialDesignsRoot`.
 */
export function compileEnumerationRecipe(
  input: EnumerationRecipe,
  context: CompileContext
): OperationIr {
  const recipe = EnumerationRecipeSchema.parse(input);
  if (!context.enumerationsRoot) {
    throw createCliError(
      `Recipe '${recipe.handle}' is an enumeration but no enumerationsRoot is configured.`,
      "INPUT_INVALID",
      {
        hint: "Set `enumerationsRoot` on the active envProfile in sitecoreai.cli.json (e.g. `/sitecore/content/<siteCollection>/<site>/Settings/Enumerations`).",
      }
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const folderRefKey = enumerationFolderId(site, recipe.handle);
  const folderPath = joinPath(context.enumerationsRoot, recipe.name);
  const folderDisplayName = recipe.displayName ?? recipe.name;

  operations.push({
    op: "CreateItem",
    policy,
    label: `enumeration:${recipe.handle}`,
    id: folderRefKey,
    path: folderPath,
    parent: { kind: "ref-path", value: context.enumerationsRoot },
    templateOf: SITECORE_TEMPLATES.FOLDER,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: ENUMERATION_FOLDER_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: folderDisplayName }),
    ],
  } satisfies CreateItemOp);

  for (const value of recipe.values) {
    const valueDisplayName = value.displayName ?? value.name;
    operations.push({
      op: "CreateItem",
      policy,
      label: `enumeration-value:${recipe.handle}/${value.name}`,
      id: enumValueId(folderRefKey, value.name),
      path: joinPath(folderPath, value.name),
      parent: { kind: "ref-recipe", refKey: folderRefKey },
      templateOf: SITECORE_TEMPLATES.FOLDER,
      name: value.name,
      fields: [
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
          kind: "string",
          value: valueDisplayName,
        }),
      ],
    } satisfies CreateItemOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
