import {
  designParameterFieldId,
  designParametersSectionId,
  designParametersTemplateId,
} from "../guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetBaseTemplatesOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../policy";
import {
  DEFAULT_ICON,
  SITECORE_TEMPLATES,
  SXA_HEADLESS_PARAMS_BASE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import {
  type DesignParametersTemplateRecipe,
  DesignParametersTemplateRecipeSchema,
} from "../schema/recipe";
import {
  PARAMS_SECTION_NAME,
  buildFieldOp,
  ensurePresentationDesignParametersBucket,
  ensureSectionFolder,
  joinPath,
  resolvePresentationDesignParametersBucketPath,
  sharedField,
  siteOf,
  versionedField,
  type CompileContext,
} from "./shared";

/**
 * Compile a standalone `DesignParametersTemplateRecipe` to an Operation IR.
 *
 * Lands at
 * `<componentsRoot>/<section>/Presentation Parameters/<name>` —
 * mirrors the layout that the synthesised inline parameters template
 * uses, so a standalone recipe and an inline-hoisted one occupy the
 * same Sitecore path.
 */
export function compileDesignParametersTemplateRecipe(
  input: DesignParametersTemplateRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  const recipe = DesignParametersTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const icon = recipe.icon ?? DEFAULT_ICON;
  const site = siteOf(context);

  ensureSectionFolder(operations, context, recipe.section, emittedFolders);
  const bucketRefKey = ensurePresentationDesignParametersBucket(
    operations,
    context,
    recipe.section,
    emittedFolders
  );
  const parentPath = resolvePresentationDesignParametersBucketPath(context, recipe.section);

  // The standalone parameters template lands at the same identity
  // (designParametersTemplateId) as inline-hoisted ones — keeps re-pushes
  // idempotent if a recipe migrates from inline to standalone.
  const tplRefKey = designParametersTemplateId(site, recipe.handle);
  const tplPath = joinPath(parentPath, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `parameters-template:${recipe.handle}`,
    id: tplRefKey,
    path: tplPath,
    parent: { kind: "ref-recipe", refKey: bucketRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetBaseTemplates",
    policy,
    label: `parameters-base-templates:${recipe.handle}`,
    itemRefKey: tplRefKey,
    // The SXA Headless params bases (BaseRenderingParameters +
    // _PerSiteStandardValues + the other SXA Headless marker) are what
    // make the Pages editor recognise this as a parameters shape and
    // surface its fields in the rendering parameters dialog. Vanilla
    // Sitecore's "Standard Rendering Parameters" doesn't work here —
    // verified empirically on tenant introspection.
    baseTemplates: [...SXA_HEADLESS_PARAMS_BASE_TEMPLATES],
  } satisfies SetBaseTemplatesOp);

  const secRefKey = designParametersSectionId(site, recipe.handle, PARAMS_SECTION_NAME);
  const secPath = joinPath(tplPath, PARAMS_SECTION_NAME);
  operations.push({
    op: "CreateItem",
    policy,
    label: `parameters-section:${recipe.handle}/${PARAMS_SECTION_NAME}`,
    id: secRefKey,
    path: secPath,
    parent: { kind: "ref-recipe", refKey: tplRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_SECTION,
    name: PARAMS_SECTION_NAME,
    fields: [],
  } satisfies CreateItemOp);

  recipe.params.forEach((param, index) => {
    operations.push(
      ...buildFieldOp({
        recipeHandle: recipe.handle,
        fieldRefKey: designParameterFieldId(site, recipe.handle, param.name),
        fieldPath: joinPath(secPath, param.name),
        parentRefKey: secRefKey,
        labelPrefix: `parameters-field:${recipe.handle}`,
        field: param,
        zeroBasedIndex: index,
        policy,
        site,
        context,
      })
    );
  });

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
