import {
  headlessVariantsSectionFolderId,
  renderingsSectionFolderId,
  sectionFolderId,
} from "../guids";
import {
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type OperationIr,
  OperationIrSchema,
} from "../ir/operations";
import { createCliError } from "../../shared/errors";
import { FOLDER_ICON, SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { type ComponentSectionRecipe, ComponentSectionRecipeSchema } from "../schema/recipe";
import { joinPath, sharedField, siteOf, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `ComponentSectionRecipe` to an Operation IR.
 *
 * Owns the three SECTION-LEVEL organisational items (one each per
 * `(site, section.name)`):
 *
 *   1. Templates section folder        — `<componentsRoot>/<name>/`
 *   4. Renderings-tree section folder  — `<renderingsRoot>/<name>/`
 *   5. Headless Variants section       — `<headlessVariantsRoot>/<name>/`
 *
 * Each carries the recipe's `displayName`, `icon`, and `sortOrder`
 * fields so the SXA editor's tree shows the section with the author's
 * intent. `compileRecipeSet` MUST process section recipes BEFORE
 * component recipes — the per-section sentinels seeded into
 * `emittedFolders` here make subsequent `ensureSectionFolder` /
 * `ensureRenderingsSectionFolder` calls from component recipes
 * no-op-with-the-section-already-existing.
 *
 * The two SUBORDINATE buckets (#2 Component Folders, #3 Presentation
 * Parameters) are NOT emitted here — they're emitted lazily by
 * `ensureComponentFoldersBucket` / `ensurePresentationDesignParametersBucket`
 * when a component recipe in the section actually needs them. They live
 * under the section folder so they inherit positional context but get
 * the default `FOLDER_ICON` (no per-bucket rich fields by design).
 *
 * The Available Renderings item (#6) is emitted by the cross-recipe
 * aggregate `buildAvailableRenderingsAggregate` in `compile.ts`; it
 * reads sections via the same `sectionsByHandle` map and applies the
 * section recipe's `displayName` to the toolbox label.
 */
export function compileComponentSectionRecipe(
  input: ComponentSectionRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  const recipe = ComponentSectionRecipeSchema.parse(input);
  const operations: Operation[] = [];
  const site = siteOf(context);
  const icon = recipe.icon ?? FOLDER_ICON;
  const displayName = recipe.displayName ?? recipe.name;

  const richFields = (): FieldValue[] => {
    const fields: FieldValue[] = [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: displayName }),
    ];
    if (recipe.sortOrder !== undefined) {
      fields.push(
        sharedField(SYSTEM_FIELDS.SORT_ORDER, { kind: "number", value: recipe.sortOrder })
      );
    }
    return fields;
  };

  // 1. Templates section folder. Lives under `componentsRoot` (Phase 2
  //    layout) when set, otherwise under `templatesRoot` (legacy flat
  //    fallback). Sentinel matches `ensureSectionFolder`'s key so
  //    subsequent component recipes see it as already-emitted.
  const templatesParent = context.componentsRoot ?? context.templatesRoot;
  const templatesSectionRefKey = sectionFolderId(site, recipe.name);
  if (!emittedFolders.has(templatesSectionRefKey)) {
    emittedFolders.add(templatesSectionRefKey);
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `section-folder:${site}:${recipe.name}`,
      id: templatesSectionRefKey,
      path: joinPath(templatesParent, recipe.name),
      parent: { kind: "ref-path", value: templatesParent },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      name: recipe.name,
      fields: richFields(),
    } satisfies CreateItemOp);
  }

  // 4. Renderings-tree section folder. Mirrors the templates side; the
  //    rendering tree shape mirrors the template tree per the layout
  //    plan. Uses `RENDERING_FOLDER` template (verified against live
  //    tenant); sentinel matches `ensureRenderingsSectionFolder`.
  const renderingsSectionRefKey = renderingsSectionFolderId(site, recipe.name);
  if (!emittedFolders.has(renderingsSectionRefKey)) {
    emittedFolders.add(renderingsSectionRefKey);
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `renderings-section-folder:${site}:${recipe.name}`,
      id: renderingsSectionRefKey,
      path: joinPath(context.renderingsRoot, recipe.name),
      parent: { kind: "ref-path", value: context.renderingsRoot },
      templateOf: SITECORE_TEMPLATES.RENDERING_FOLDER,
      name: recipe.name,
      fields: richFields(),
    } satisfies CreateItemOp);
  }

  // 5. Headless Variants section grouping. Only emitted when the tenant
  //    is configured for variants (`headlessVariantsRoot` set); the
  //    sentinel matches the inline emission in
  //    `component-template.ts:emitVariants` so component recipes that
  //    declare variants don't double-emit.
  if (context.headlessVariantsRoot) {
    const variantsSectionRefKey = headlessVariantsSectionFolderId(site, recipe.name);
    if (!emittedFolders.has(variantsSectionRefKey)) {
      emittedFolders.add(variantsSectionRefKey);
      operations.push({
        op: "CreateItem",
        policy: "CreateOnly",
        label: `headless-variants-section-folder:${site}:${recipe.name}`,
        id: variantsSectionRefKey,
        path: joinPath(context.headlessVariantsRoot, recipe.name),
        parent: { kind: "ref-path", value: context.headlessVariantsRoot },
        templateOf: SITECORE_TEMPLATES.HEADLESS_VARIANTS_GROUPING,
        name: recipe.name,
        fields: richFields(),
      } satisfies CreateItemOp);
    }
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Look up a `ComponentSectionRecipe` by handle. Throws INPUT_INVALID
 * with a helpful hint when a component references a section handle no
 * `ComponentSectionRecipe` in the set provides — this is the
 * cross-recipe validation that closes the implicit-fallback gap the
 * old `section: string` field had.
 *
 * `consumerHandle` is the recipe doing the lookup (used in the error
 * message so authors can locate the source of the bad reference).
 */
export const resolveSectionRecipe = (
  consumerHandle: string,
  sectionHandle: string,
  sectionsByHandle: ReadonlyMap<string, ComponentSectionRecipe> | undefined
): ComponentSectionRecipe => {
  const section = sectionsByHandle?.get(sectionHandle);
  if (!section) {
    throw createCliError(
      `Recipe '${consumerHandle}' references section.handle='${sectionHandle}' but no ComponentSectionRecipe with that handle is in the set.`,
      "INPUT_INVALID",
      {
        hint: "Add a `ComponentSectionRecipe` (kind: 'component-section') with the matching handle to the recipe set, or change the consumer's `section.handle` to point at an existing one.",
      }
    );
  }
  return section;
};
