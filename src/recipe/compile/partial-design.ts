import { createScaiError } from "@/shared/errors";
import { contentItemId, partialDesignId, renderingId } from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  DEFAULT_DEVICE_ID,
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  LAYOUT_FIELDS,
  SITECORE_TEMPLATES,
  SXA_JSON_LAYOUT_ID,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { type PartialDesignRecipe, PartialDesignRecipeSchema } from "../schema/recipe";
import { emitLayoutXml } from "../layout/emit";
import { layoutEncodingOptions } from "./layout-encoding";
import {
  collectDataInsertOptions,
  collectScopedSlots,
  materializeScopedDatasources,
} from "./scoped-datasources";
import { joinPath, sharedField, siteOf, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `PartialDesignRecipe` to an Operation IR.
 *
 * Emits:
 *   1. `CreateItem` for the partial-design item (SXA Partial Design template)
 *   2. `SetField(__Renderings)` — the shared device + JSON-layout shell only
 *   3. `SetField(__Final Renderings)` — the placements, as an SXA delta patched
 *      over that shell (the same two-field model pages use, verified against a
 *      UI-authored partial design)
 *
 * The compiler resolves component / content-item handles in the layout
 * to deterministic GUIDs at compile time — no executor-side handle
 * resolution required for the layout body. (Page-template handles in
 * `appliesTo` and partial handles in `partials[]` on `PageDesignRecipe`
 * resolve the same way.)
 */
export function compilePartialDesignRecipe(
  input: PartialDesignRecipe,
  context: CompileContext
): OperationIr {
  const recipe = PartialDesignRecipeSchema.parse(input);
  if (!context.partialDesignsRoot) {
    throw createScaiError(
      `compilePartialDesignRecipe requires context.partialDesignsRoot; tenant-side path missing for recipe ${recipe.handle}`,
      "INPUT_INVALID"
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const itemRefKey = partialDesignId(site, recipe.handle);
  const itemPath = joinPath(context.partialDesignsRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `partial-design:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.partialDesignsRoot },
    templateOf: SITECORE_TEMPLATES.PARTIAL_DESIGN,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  // A partial design hosts its own scoped datasources at
  // `<partial-design>/Data/<slot>` — every page that uses the partial shares
  // the one materialised item (the right semantics for design chrome, e.g. a
  // footer sign-off). Structure ops land before the layout SetField (whose
  // `ds="local:/Data/<slot>"` resolves against them); field ops after the
  // items exist. The renderings reference their slot with the page-relative
  // `local:/Data/<slot>` form — the same wire form XM Cloud Pages writes for a
  // partial design's own datasources, and where `local:` resolves for the
  // partial's renderings (the items live under the partial design, exactly
  // where Pages authors them).
  const scoped = materializeScopedDatasources({
    hostItemRefKey: itemRefKey,
    hostItemPath: itemPath,
    scopedSlots: collectScopedSlots(recipe.layout),
    insertOptionHandles: collectDataInsertOptions(recipe.layout, context),
    site,
    policy,
    context,
    recipeHandle: recipe.handle,
    labelPrefix: "partial-design",
  });
  operations.push(...scoped.structureOps);

  // Shared `__Renderings` shell: device + JSON-layout pointer, no placements.
  // A partial design isn't an instance of a page template, so it can't inherit
  // this shell from standard values the way a page does — it must carry it on
  // its own item. `emitLayoutXml` with `layoutId` set emits `<r><d id l /></r>`
  // even for an empty layout.
  const shellXml = emitLayoutXml(
    { placeholders: {} },
    {
      parentItemId: itemRefKey,
      deviceId: DEFAULT_DEVICE_ID,
      layoutId: SXA_JSON_LAYOUT_ID,
      renderingIdFor: (handle) => renderingId(site, handle),
      contentItemIdFor: (handle) => contentItemId(site, handle),
      allowScoped: false,
      mode: "canonical",
    }
  );
  operations.push({
    op: "SetField",
    policy,
    label: `partial-design-renderings-shell:${recipe.handle}`,
    itemRefKey,
    fieldId: LAYOUT_FIELDS.RENDERINGS,
    value: { kind: "string", value: shellXml },
  } satisfies SetFieldOp);

  const layoutXml = emitLayoutXml(recipe.layout, {
    parentItemId: itemRefKey,
    deviceId: DEFAULT_DEVICE_ID,
    renderingIdFor: (handle) => renderingId(site, handle),
    contentItemIdFor: (handle) => contentItemId(site, handle),
    // Scoped placements ride as `ds="local:/Data/<slot>"` page-relative paths
    // (no scopedDatasourceIdFor) — matching XM Cloud Pages' own wire form for a
    // partial design's datasources and the `<partial-design>/Data/<slot>` items
    // materialised above.
    allowScoped: true,
    // Encode variants + params in the wire form Pages reads back — SAME as
    // pages, so a partial's renderings don't render with unresolved variants.
    ...layoutEncodingOptions(site, context),
    // The placements are the per-version `__Final Renderings`, an SXA delta
    // merged over the `__Renderings` shell above. No `<p:da name="l" />`
    // directive (`deltaDeviceDirective: false`) — the `l=` pointer lives in the
    // shell, matching a page's `__Final Renderings` and UI-authored partials.
    mode: "delta",
    deltaDeviceDirective: false,
  });

  if (layoutXml.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `partial-design-layout:${recipe.handle}`,
      itemRefKey,
      fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value: { kind: "string", value: layoutXml },
    } satisfies SetFieldOp);
  }
  operations.push(...scoped.fieldOps);

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
