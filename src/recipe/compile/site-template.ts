import { createScaiError } from "@/shared/errors";
import { templateId } from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  DEFAULT_ICON,
  SITECORE_TEMPLATES,
  SITE_TEMPLATE_FIELDS,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { type SiteTemplateRecipe, SiteTemplateRecipeSchema } from "../schema/recipe";
import { joinPath, sharedField, siteOf, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `SiteTemplateRecipe` to an Operation IR.
 *
 * Emits the SiteTemplate item (a `Solution template`-typed item under
 * `siteTemplatesRoot`) with the fields SXA's createSite flow actually
 * reads: Name, Description, Enabled, Built-in template marker, plus
 * stub ICON / DISPLAY_NAME.
 *
 * **Design gap (acknowledged, not closed by this commit):** the
 * `SiteTemplateRecipe` schema models brand shape as direct lists of
 * page templates, page designs, an insert-options matrix, a
 * templates-to-designs mapping, dictionary entries, and taxonomy
 * roots. SXA's Solution template doesn't carry any of those directly
 * — it carries a `Site Modules` + `Tenant Modules` list of MODULE
 * item refs, and modules hold the brand structure. Mapping the
 * recipe schema's high-level fields to SXA modules is open work
 * (probably needs a `ModuleRecipe` kind, or a "modules" array on
 * SiteTemplateRecipe that resolves to existing module item GUIDs).
 *
 * Sandbox introspection (2026-05-01) confirmed:
 *   - SXA "Site Template" = item conforming to `Solution template`
 *     (templateId 1b2dfd3b-f2f2-4f40-a75c-f6c2490919c4)
 *   - Built-in templates live at `/sitecore/system/Settings/Foundation/
 *     JSS Experience Accelerator/Scaffolding/Templates`
 *   - Field GUIDs captured in SITE_TEMPLATE_FIELDS (sitecore-templates.ts)
 *
 * What this commit emits:
 *   - CreateItem with the correct `templateOf` GUID
 *   - SetField for Name (Solution-template's `Name` field, not __Display Name)
 *   - SetField for Description (when recipe.description is set)
 *   - SetField for Enabled = "1"
 *   - SetField for Built-in template = "0" (recipe-authored, not SXA-shipped)
 *
 * Deferred to a follow-up plan revision (because the recipe-schema-to-
 * SXA-modules mapping needs design):
 *   - Site Modules / Tenant Modules SetFields populated from the recipe's
 *     pageTemplates / pageDesigns / etc. (currently they need to map to
 *     existing module item GUIDs, which we don't yet)
 *   - Dictionary subitems (live under <site>/Dictionary, not under
 *     the site template; they're per-site, not per-template)
 *   - Taxonomy: no per-site Taxonomy folder found on the sandbox; the
 *     SXA convention may put taxonomy elsewhere or it may not be a
 *     site-template concern
 *
 * Identity: `templateId(handle)` derives the SiteTemplate item's
 * deterministic refKey.
 */
export function compileSiteTemplateRecipe(
  input: SiteTemplateRecipe,
  context: CompileContext
): OperationIr {
  const recipe = SiteTemplateRecipeSchema.parse(input);
  if (!context.siteTemplatesRoot) {
    throw createScaiError(
      `compileSiteTemplateRecipe requires context.siteTemplatesRoot; tenant-side path missing for recipe ${recipe.handle}`,
      "INPUT_INVALID"
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const itemRefKey = templateId(siteOf(context), recipe.handle);
  const itemPath = joinPath(context.siteTemplatesRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `site-template:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.siteTemplatesRoot },
    templateOf: SITECORE_TEMPLATES.SITE_TEMPLATE,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  // Solution template's own `Name` field — distinct from __Display Name.
  // SXA's Sites UI reads this for the template chooser.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-name:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.NAME,
    value: { kind: "string", value: recipe.displayName },
  } satisfies SetFieldOp);

  if (recipe.description) {
    operations.push({
      op: "SetField",
      policy,
      label: `site-template-description:${recipe.handle}`,
      itemRefKey,
      fieldId: SITE_TEMPLATE_FIELDS.DESCRIPTION,
      value: { kind: "string", value: recipe.description },
    } satisfies SetFieldOp);
  }

  // Available for site creation by default.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-enabled:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.ENABLED,
    value: { kind: "string", value: "1" },
  } satisfies SetFieldOp);

  // "Built-in" is a marker for SXA-shipped templates — recipe-authored
  // ones explicitly mark themselves as not built-in so the Sites UI can
  // distinguish operator-authored brand templates from the canned ones.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-builtin:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.BUILT_IN_TEMPLATE,
    value: { kind: "string", value: "0" },
  } satisfies SetFieldOp);

  // TODO (next plan revision — needs design):
  //   - Module resolution. SXA stores brand structure in MODULES, not
  //     directly on the Solution template. recipe.pageTemplates,
  //     recipe.pageDesigns, recipe.insertOptionsMatrix,
  //     recipe.templatesToDesigns map to module composition that this
  //     compiler doesn't yet model. Site Modules + Tenant Modules
  //     SetFields would carry pipe-separated module-item GUIDs once
  //     the schema gains a module-references field (or a separate
  //     ModuleRecipe kind that the compiler can resolve to GUIDs).
  //   - Dictionary entries. Per-site Dictionary lives under
  //     <site>/Dictionary, not under the site template. SiteRecipe
  //     compile (Milestone D) is the right place to set those.
  //   - Taxonomy. No per-site Taxonomy folder discovered on the
  //     sandbox; the SXA convention isn't clear yet. Defer.

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
