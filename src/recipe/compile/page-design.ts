import { createScaiError } from "@/shared/errors";
import { contentItemId, pageDesignId, partialDesignId, renderingId } from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  COMPOSITION_FIELDS,
  DEFAULT_DEVICE_ID,
  DEFAULT_ICON,
  LAYOUT_FIELDS,
  SITECORE_TEMPLATES,
  SXA_JSON_LAYOUT_ID,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { type PageDesignRecipe, PageDesignRecipeSchema } from "../schema/recipe";
import { emitLayoutXml } from "../layout/emit";
import { layoutEncodingOptions } from "./layout-encoding";
import {
  collectDataInsertOptions,
  collectScopedSlots,
  materializeScopedDatasources,
} from "./scoped-datasources";
import { joinPath, sharedField, siteOf, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `PageDesignRecipe` to an Operation IR.
 *
 * Emits:
 *   1. `CreateItem` for the page-design item (SXA Page Design template)
 *   2. `SetField(PartialDesigns)` — pipe-separated GUID list of partials
 *   3. `SetField(__Renderings)` — the device + JSON-layout shell (always
 *      emitted), plus any own placements the design declares
 *
 * The recipe's `appliesTo` contributions to the Page Designs root's
 * `TemplatesMapping` field are NOT emitted here — that field is
 * cross-recipe (every page design contributes a slice) and a per-recipe
 * `kind: "string"` write would full-replace under the executor's write
 * semantics, with each page design overwriting its siblings. Use
 * `compileRecipeSet` (below) to compile a coherent set of recipes —
 * it aggregates `appliesTo` contributions across every page-design
 * recipe in the set into one combined IR.
 */
export function compilePageDesignRecipe(
  input: PageDesignRecipe,
  context: CompileContext
): OperationIr {
  const recipe = PageDesignRecipeSchema.parse(input);
  if (!context.pageDesignsRoot) {
    throw createScaiError(
      `compilePageDesignRecipe requires context.pageDesignsRoot; tenant-side path missing for recipe ${recipe.handle}`,
      "INPUT_INVALID"
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const itemRefKey = pageDesignId(site, recipe.handle);
  const itemPath = joinPath(context.pageDesignsRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `page-design:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.pageDesignsRoot },
    templateOf: SITECORE_TEMPLATES.PAGE_DESIGN,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  if (recipe.partials.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `page-design-partials:${recipe.handle}`,
      itemRefKey,
      fieldId: COMPOSITION_FIELDS.PARTIAL_DESIGNS,
      value: {
        kind: "ref-recipe-list",
        refKeys: recipe.partials.map((handle) => partialDesignId(site, handle)),
      },
    } satisfies SetFieldOp);
  }

  // Always stamp the `__Renderings` shell — device + `l="{JSON layout}"`
  // pointer — on the page-design item (a page design that applies to `page@1`
  // must carry the shell so pages using it render through the headless JSON
  // layout pipeline). A page design's own placements (rare — it's usually just
  // partial references) ride in this same canonical field; its
  // `__Final Renderings` stays blank, since the pages that apply the design own
  // that field. When the design declares no layout, the bare shell is emitted.
  const hasOwnLayout = recipe.layout != null && Object.keys(recipe.layout.placeholders).length > 0;
  const scoped = hasOwnLayout
    ? materializeScopedDatasources({
        hostItemRefKey: itemRefKey,
        hostItemPath: itemPath,
        scopedSlots: collectScopedSlots(recipe.layout),
        insertOptionHandles: collectDataInsertOptions(recipe.layout, context),
        site,
        policy,
        context,
        recipeHandle: recipe.handle,
        labelPrefix: "page-design",
      })
    : undefined;
  if (scoped) operations.push(...scoped.structureOps);

  const layoutXml = emitLayoutXml(recipe.layout ?? { placeholders: {} }, {
    parentItemId: itemRefKey,
    deviceId: DEFAULT_DEVICE_ID,
    // `layoutId` makes the emitter produce `<r><d id l /></r>` even for an
    // empty layout — the device + JSON-layout shell a page design needs.
    layoutId: SXA_JSON_LAYOUT_ID,
    renderingIdFor: (handle) => renderingId(site, handle),
    contentItemIdFor: (handle) => contentItemId(site, handle),
    // The page design item IS the host — scoped placements resolve against
    // the `<page-design>/Data/<slot>` items materialised above (by GUID).
    allowScoped: true,
    scopedDatasourceIdFor: scoped?.scopedDatasourceIdFor,
    // Encode variants + params in the wire form Pages reads back — SAME as
    // pages, so the design's renderings don't render with unresolved variants.
    ...layoutEncodingOptions(site, context),
    // Page Design preserves canonical input on read-back — keep emitting
    // canonical so the layout XML round-trips byte-for-byte.
    mode: "canonical",
  });
  operations.push({
    op: "SetField",
    policy,
    label: `page-design-layout:${recipe.handle}`,
    itemRefKey,
    fieldId: LAYOUT_FIELDS.RENDERINGS,
    value: { kind: "string", value: layoutXml },
  } satisfies SetFieldOp);
  if (scoped) operations.push(...scoped.fieldOps);

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
