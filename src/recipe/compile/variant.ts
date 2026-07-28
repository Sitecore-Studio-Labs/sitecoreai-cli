import { createScaiError } from "@/shared/errors";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
} from "../ir/operations";
import { SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { variantId, variantsFolderId } from "../items/guids";
import { defaultPolicyForRecipe } from "../runtime/policy";
import { type VariantRecipe, VariantRecipeSchema } from "../schema/recipe";
import { type CompileContext, joinPath, siteOf, versionedField } from "./shared";

/**
 * Compile a `VariantRecipe` to an Operation IR.
 *
 * Emits two Sitecore writes — the per-rendering Headless Variants
 * folder (idempotent via the executor's CreateOrUpdate semantics) and
 * the VARIANT_DEFINITION item itself:
 *
 *   1. `HEADLESS_VARIANTS` at
 *      `<headlessVariantsRoot>/<targetRendering.name>/`
 *   2. `VARIANT_DEFINITION` at
 *      `<headlessVariantsRoot>/<targetRendering.name>/<name>`
 *
 * The tree MUST be flat — no section-grouping intermediate. Pages
 * chrome walks exactly two levels under `headlessVariantsRoot` and
 * stops at the rendering folder; a `root/<section>/<rendering>/<variant>`
 * shape makes Pages discover zero variants for the rendering. The
 * inline-variants emission inside `component-template.ts:emitVariants`
 * documents this with a 2026-05-31 live-tenant verification — same
 * rule applies here.
 *
 * `recipe.content` (the TSX source for the head-repo sidecar) is NOT
 * consumed by this compile step — it's read by the install descriptor /
 * file-drop pipeline that writes the file into the head repo. scai's
 * scope is the Sitecore-side emission only.
 *
 * The canonical ComponentTemplateRecipe is NOT mutated by anything
 * this function emits — the only ops are creates under the
 * headless-variants folder. This is what makes "recipe is sacred"
 * a schema-enforceable property of brand variants rather than a
 * convention.
 */
export function compileVariantRecipe(input: VariantRecipe, context: CompileContext): OperationIr {
  const recipe = VariantRecipeSchema.parse(input);
  if (!context.headlessVariantsRoot) {
    throw createScaiError(
      `VariantRecipe '${recipe.handle}' requires headlessVariantsRoot but none is configured.`,
      "INPUT_INVALID",
      {
        hint: "Set `headlessVariantsRoot` on the active envProfile in sitecoreai.cli.json (e.g. `/sitecore/content/<siteCollection>/<site>/Presentation/Headless Variants`).",
      }
    );
  }
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const root = context.headlessVariantsRoot;
  const operations: Operation[] = [];

  // Per-rendering folder under the headless variants root. Same
  // refKey + template the inline-variants emitter uses, so the two
  // paths converge on the same Sitecore item: a brand variant for a
  // rendering whose canonical also declares inline variants writes
  // to the same folder without colliding.
  const folderRefKey = variantsFolderId(site, recipe.targetRendering.handle);
  const folderPath = joinPath(root, recipe.targetRendering.name);
  operations.push({
    op: "CreateItem",
    policy,
    label: `variants-folder:${recipe.targetRendering.handle}`,
    id: folderRefKey,
    path: folderPath,
    parent: { kind: "ref-path", value: root },
    templateOf: SITECORE_TEMPLATES.HEADLESS_VARIANTS,
    name: recipe.targetRendering.name,
    fields: [],
  } satisfies CreateItemOp);

  // The variant item itself. Its ID is deterministic from
  // (site, canonical handle, variant name), so two installs of the
  // same brand variant in the same tenant resolve to the same item.
  operations.push({
    op: "CreateItem",
    policy,
    label: `variant:${recipe.targetRendering.handle}/${recipe.name}`,
    id: variantId(site, recipe.targetRendering.handle, recipe.name),
    path: joinPath(folderPath, recipe.name),
    parent: { kind: "ref-recipe", refKey: folderRefKey },
    templateOf: SITECORE_TEMPLATES.VARIANT_DEFINITION,
    name: recipe.name,
    fields: [
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
        kind: "string",
        value: recipe.displayName ?? recipe.name,
      }),
    ],
  } satisfies CreateItemOp);

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
