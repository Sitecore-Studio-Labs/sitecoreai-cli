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
  LAYOUT_FIELDS,
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { type PartialDesignRecipe, PartialDesignRecipeSchema } from "../schema/recipe";
import { emitLayoutXml } from "../layout/emit";
import { flattenLayout } from "./flatten-layout";
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
 *   2. `SetField(__Renderings)` — the full layout (SXA delta) written to
 *      Sitecore's SHARED layout field, so the chrome is language-independent:
 *      every language version of a page composing this partial inherits it.
 *      (Writing the placements to a per-language `__Final Renderings @ en`
 *      delta instead stranded the chrome in the default language's Final
 *      layout — any other language version, and the Shared Layout view itself,
 *      then rendered no header/footer.)
 *
 * The compiler resolves component / content-item handles in the layout
 * to deterministic GUIDs at compile time — no executor-side handle
 * resolution required for the layout body. (Page-template handles in
 * `appliesTo` and partial handles in `partials[]` on `PageDesignRecipe`
 * resolve the same way.)
 *
 * Nested placements (a shell component hosting children in its own
 * logical slots) are flattened into dynamic-placeholder keys before
 * emission — exactly the page compiler's convention (`./flatten-layout`).
 * The flattened children ride the same shared `__Renderings` delta as
 * their parent.
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

  // Flatten nested placements — a placeholder-composed shell like
  // `footer@1` hosting children in its own logical slots (`footer-main`,
  // `footer-bottom`) — into concrete dynamic-placeholder keys BEFORE
  // anything walks the layout: scoped-slot collection, insert options,
  // and emission all consume the flat shape. Identical key derivation to
  // the page compiler (`./flatten-layout`), so the same shell composes
  // the same way in a page or in design chrome. Site chrome (headers,
  // footers) lives in partial designs, which is exactly where the
  // registry's shell-composed experiences need nesting.
  const layout = flattenLayout(recipe.layout);

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
    scopedSlots: collectScopedSlots(layout),
    insertOptionHandles: collectDataInsertOptions(layout, context),
    site,
    policy,
    context,
    recipeHandle: recipe.handle,
    labelPrefix: "partial-design",
  });
  operations.push(...scoped.structureOps);

  const layoutXml = emitLayoutXml(layout, {
    parentItemId: itemRefKey,
    deviceId: DEFAULT_DEVICE_ID,
    renderingIdFor: (handle) => renderingId(site, handle),
    contentItemIdFor: (handle) => contentItemId(site, handle),
    // Scoped placements ride as `ds="local:/Data/<slot>"` page-relative paths
    // (no scopedDatasourceIdFor) — the wire form XM Cloud Pages writes for a
    // partial design's own datasources, resolved against the
    // `<partial-design>/Data/<slot>` items materialised above. Unchanged from
    // the prior behavior; only the destination FIELD moves (see below).
    allowScoped: true,
    // Encode variants + params in the wire form Pages reads back — SAME as
    // pages, so a partial's renderings don't render with unresolved variants.
    ...layoutEncodingOptions(site, context),
    // SHARED-layout wire form, byte-identical to a Pages-authored partial
    // design's `__Renderings` (operator-verified 2026-07-17):
    //
    //   <r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{DEVICE}">
    //     <r uid="…" s:ds="local:/Data/…" s:id="…" s:par="…" s:ph="…" />
    //   </d></r>
    //
    // A SELF-CONTAINED device layout: explicit `<d id="{DEVICE}">` with
    // anchor-less renderings (document order) and NO `<p:da name="l" />`
    // inherit directive. The prior form (`deltaDeviceDirective` +
    // `deltaAnchors` both default-true) emitted `<d><p:da name="l" /><r
    // p:before|p:after …/></d>` — an INHERIT delta that merges over a
    // base device layout. A partial design opened DIRECTLY in Page
    // Builder (not composed into a page) has no base to merge against, so
    // the CM layout service 500s and Pages falls back to `nolayout.aspx`
    // — the partial is uneditable standalone. Same treatment the page
    // SHARED layout uses, minus the page's `<p:da name="xsi" />` root
    // directive (`deltaSharedForm`), which authored partials don't carry.
    mode: "delta",
    deltaDeviceDirective: false,
    deltaAnchors: false,
  });

  if (layoutXml.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `partial-design-layout:${recipe.handle}`,
      itemRefKey,
      // SHARED layout (`__Renderings`), NOT the per-language `__Final
      // Renderings` — see the emit summary above. Shared field: no
      // language/version.
      fieldId: LAYOUT_FIELDS.RENDERINGS,
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
