import { v5 as uuidv5 } from "@/shared/uuid";
import { contentItemId, renderingId, standardValuesId, workflowId } from "../items/guids";
import {
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  DEFAULT_DEVICE_ID,
  LAYOUT_FIELDS,
  PAGE_TEMPLATE_ICON,
  SXA_HEADLESS_PAGE_BASE_TEMPLATES,
  SXA_JSON_LAYOUT_ID,
} from "../ir/sitecore-templates";
import { type PageTemplateRecipe, PageTemplateRecipeSchema } from "../schema/recipe";
import { emitLayoutXml } from "../layout/emit";
import { joinPath, siteOf, type CompileContext } from "./shared";
import { ensurePageTemplatesGroupFolder } from "./folders";
import { emitDatasourceTemplate } from "./datasource-template";

/**
 * Compile a `PageTemplateRecipe` to an Operation IR.
 *
 * A page template is a Sitecore data template that pages conform to. It
 * differs from a `ContentTemplateRecipe` in two ways:
 *
 *   1. It chains the SXA Headless page facet set
 *      (`SXA_HEADLESS_PAGE_BASE_TEMPLATES`) directly — the same facets
 *      the SXA-scaffolded `Project/<collection>/Page` carries, making
 *      it a peer of that scaffold — so items conforming to it pick up
 *      the layout / navigation / taxonomy / page-design / sitemap
 *      facets that make them authorable pages in XM Cloud Pages.
 *   2. Its `__Standard Values` carries a `__Renderings` layout shell —
 *      `<r><d id="{device}" l="{jsonLayout}" /></r>` — so pages render
 *      through the headless JSON-layout pipeline. When the recipe
 *      declares a `layout`, its placements are seeded into that shell.
 *
 * Everything else (template item, sections, fields, standard values,
 * insert options, default workflow) is the same datasource-template
 * shape `compileContentTemplateRecipe` emits — reused via
 * `emitDatasourceTemplate`.
 *
 * Path:
 *   - `meta.tax.group` set → `<pageTemplatesRoot ?? templatesRoot>/<group>/<name>`
 *     (the group folder is emitted once per set as a CreateOnly op).
 *   - no group → flat at `<pageTemplatesRoot ?? templatesRoot>/<name>`.
 */
export function compilePageTemplateRecipe(
  input: PageTemplateRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  const recipe = PageTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);

  const root = context.pageTemplatesRoot ?? context.templatesRoot;
  // `meta.tax.group` nests the template one folder level deep; the
  // group folder is materialised once per (site, group) via the
  // `emittedFolders` dedup set.
  const group = recipe.meta?.tax?.group;
  let parentPath = root;
  let parentRefKey: string | undefined;
  if (group) {
    const groupRefKey = ensurePageTemplatesGroupFolder(operations, context, group, emittedFolders);
    parentPath = joinPath(root, group);
    parentRefKey = groupRefKey;
  }

  // Template item + base templates + sections + fields + standard
  // values + insert options.
  //
  // Inheritance: the SXA Foundation page facet set (`Base Page`,
  // `_Navigable`, `_Taggable`, `_Designable`, `_Sitemap`) is chained
  // DIRECTLY — the same facets the SXA-scaffolded
  // `/sitecore/templates/Project/<collection>/Page` carries, making the
  // recipe template a PEER of that scaffold rather than a subtype of
  // it. An earlier iteration inherited the scaffold by tenant path
  // (`SetBaseTemplates.pathBases`); operator verdict on live tenants
  // was that subtyping the scaffold is NOT the desired shape — the
  // per-site template should mirror its facet chain instead. The
  // pathBases mechanism remains available on the op for other callers.
  //
  // The implicit Standard template is omitted: `Base Page` chains it
  // transitively, so listing it explicitly is redundant noise in the
  // Content Editor's inheritance view.
  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      ...(recipe.insertOptions !== undefined && { insertOptions: recipe.insertOptions }),
      parentPath,
      ...(parentRefKey !== undefined && { parentRefKey }),
      additionalBaseTemplates: SXA_HEADLESS_PAGE_BASE_TEMPLATES,
      omitStandardBaseTemplate: true,
    },
    context,
    recipe.icon ?? PAGE_TEMPLATE_ICON,
    policy
  );

  // Stamp the standard-values layout shell. `emitLayoutXml` with
  // `layoutId` set emits `<r><d id l />…</r>` even when the recipe
  // declares no placements — device + JSON-layout pointer is the
  // minimum a page's `__Renderings` needs.
  const svRefKey = standardValuesId(site, recipe.handle);
  const layoutXml = emitLayoutXml(recipe.layout ?? { placeholders: {} }, {
    parentItemId: svRefKey,
    deviceId: DEFAULT_DEVICE_ID,
    layoutId: SXA_JSON_LAYOUT_ID,
    renderingIdFor: (handle) => renderingId(site, handle),
    contentItemIdFor: (handle) => contentItemId(site, handle),
    // Page templates' standard-values layout never carries scoped
    // datasource refs — those resolve against a host page, which a
    // template doesn't have.
    allowScoped: false,
    mode: "canonical",
  });
  operations.push({
    op: "SetField",
    policy,
    label: `page-template-layout:${recipe.handle}`,
    itemRefKey: svRefKey,
    fieldId: LAYOUT_FIELDS.RENDERINGS,
    value: { kind: "string", value: layoutXml },
  } satisfies SetFieldOp);

  // Optional workflow binding on the standard-values item — new pages
  // of this template enter the workflow at its initial state. Mirrors
  // `compileContentTemplateRecipe`.
  if (recipe.defaultWorkflow) {
    operations.push({
      op: "SetField",
      policy,
      label: `page-template-default-workflow:${recipe.handle}`,
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
 * Stable refKey for a Sitecore standard field on `itemRefKey`. Same
 * derivation as `compile/content-template.ts` — declared separately to
 * keep the modules independent (see that file's note).
 */
const STANDARD_FIELD_REFKEY_NAMESPACE = uuidv5(
  "standard-field",
  "d6c28e9f-21f3-56ee-ada3-f2a947c3d475" // NAMESPACE_ROOT
);
const deriveStandardFieldId = (parentRefKey: string, fieldName: string): string =>
  uuidv5(`${parentRefKey}:${fieldName}`, STANDARD_FIELD_REFKEY_NAMESPACE);
