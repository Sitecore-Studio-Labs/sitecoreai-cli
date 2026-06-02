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
import { joinPath, sharedField, siteOf, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `PartialDesignRecipe` to an Operation IR.
 *
 * Emits two ops:
 *   1. `CreateItem` for the partial-design item (SXA Partial Design template)
 *   2. `SetField` writing the layout XML to `__Renderings` (shared layout)
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

  const layoutXml = emitLayoutXml(recipe.layout, {
    parentItemId: itemRefKey,
    deviceId: DEFAULT_DEVICE_ID,
    renderingIdFor: (handle) => renderingId(site, handle),
    contentItemIdFor: (handle) => contentItemId(site, handle),
    allowScoped: false,
    // SXA Partial Design's Layout pipeline normalizes canonical input
    // into delta form on first write — emit delta directly so first
    // push converges in one cycle (the alternative is the two-cycle
    // workaround documented in commit 6404024).
    mode: "delta",
  });

  if (layoutXml.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `partial-design-layout:${recipe.handle}`,
      itemRefKey,
      fieldId: LAYOUT_FIELDS.RENDERINGS,
      value: { kind: "string", value: layoutXml },
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
