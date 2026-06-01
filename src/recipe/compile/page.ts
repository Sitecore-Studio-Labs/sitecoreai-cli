import { v5 as uuidv5 } from "uuid";
import { createScaiError } from "@/shared/errors";
import {
  contentItemId,
  datasourceId,
  fieldId,
  pageItemId,
  renderingId,
  templateId,
  workflowId,
} from "../items/guids";
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
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { type PageRecipe, PageRecipeSchema } from "../schema/recipe";
import { emitLayoutXml } from "../layout/emit";
import { encodeContentFieldValue } from "./content-item";
import { joinPath, sharedField, siteOf, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `PageRecipe` to an Operation IR.
 *
 * A page is a concrete content-tree item conforming to a page template.
 * Emits:
 *   1. `CreateItem` for the page item under `pagesRoot`, with
 *      `templateOf` pointing at the `PageTemplateRecipe`'s template.
 *   2. One `SetField` per `fields` entry — page-template field values,
 *      encoded the same way `compileContentItemRecipe` encodes them.
 *   3. A `CreateItem` for `<page>/Data` and one per `scoped` placement —
 *      page-local datasource items conforming to the placed component's
 *      datasource template (see the layout block).
 *   4. `SetField(__Final Renderings)` — the page's own layout (when
 *      `layout` is declared), in canonical wire form. `scoped`
 *      placements resolve to the `<page>/Data/<slot>` GUIDs; `shared`
 *      points at a `ContentItemRecipe`; `none` is config-driven.
 *   5. `SetField(__Workflow)` — when `workflow` is set.
 *
 * Policy is `CreateOnly` (the `page-item` purpose): the registry seeds
 * the page, authors own it thereafter, and a re-push never overwrites
 * their edits.
 */
export function compilePageRecipe(input: PageRecipe, context: CompileContext): OperationIr {
  const recipe = PageRecipeSchema.parse(input);
  if (!context.pagesRoot) {
    throw createScaiError(
      `compilePageRecipe requires context.pagesRoot; tenant-side path missing for recipe ${recipe.handle}`,
      "INPUT_INVALID",
      {
        hint: "Set `pagesRoot` on the active envProfile in sitecoreai.cli.json — e.g. `/sitecore/content/<tenant>/<site>/Home`.",
      }
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const itemRefKey = pageItemId(site, recipe.handle);
  const itemPath = joinPath(context.pagesRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `page:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.pagesRoot },
    // String GUID — resolves as a refKey when the page template ships in
    // the same set (`templateId(template)` is captured at apply time),
    // else as a literal Sitecore template GUID.
    templateOf: templateId(site, recipe.template),
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  // Page field values — keyed by field name on the page template.
  for (const [fieldName, fieldValue] of Object.entries(recipe.fields)) {
    const value = encodeContentFieldValue(fieldValue, recipe.handle, site);
    if (value === null) continue;
    operations.push({
      op: "SetField",
      policy,
      label: `page-field:${recipe.handle}:${fieldName}`,
      itemRefKey,
      // Recipe-created field — Sitecore assigns its own GUID, so this
      // is an IR-internal refKey; the mutation resolves via `fieldName`.
      fieldId: fieldId(site, recipe.template, fieldName),
      fieldName,
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value,
    } satisfies SetFieldOp);
  }

  // Page-local layout → `__Final Renderings` (versioned — per-language
  // final layout).
  if (recipe.layout && Object.keys(recipe.layout.placeholders).length > 0) {
    // Scoped placements materialise page-local datasource items under
    // `<page>/Data`. Each conforms to the placed component's datasource
    // template — a separate `ContentTemplateRecipe` when the component
    // declares one, else the component template itself.
    const scopedSlots = new Map<string, string>();
    for (const placements of Object.values(recipe.layout.placeholders)) {
      for (const placement of placements) {
        if (placement.datasourceRef?.kind === "scoped") {
          scopedSlots.set(placement.datasourceRef.slot, placement.componentHandle);
        }
      }
    }

    if (scopedSlots.size > 0) {
      // The `<page>/Data` folder — materialised once, CreateOnly.
      const dataFolderRefKey = datasourceId(itemRefKey, "Data");
      const dataFolderPath = joinPath(itemPath, "Data");
      operations.push({
        op: "CreateItem",
        policy: "CreateOnly",
        label: `page-data-folder:${recipe.handle}`,
        id: dataFolderRefKey,
        path: dataFolderPath,
        parent: { kind: "ref-recipe", refKey: itemRefKey },
        templateOf: SITECORE_TEMPLATES.FOLDER,
        name: "Data",
        fields: [],
      } satisfies CreateItemOp);

      // Insert Options (`__Masters`) on the Data folder — the union of
      // datasource templates across EVERY rendering on the page (not just
      // scoped ones). Authors who turn off the rendering's `autoCreate`
      // — or who want to add an extra datasource later — see the right
      // set in the right-click → Insert menu. Without this, the Data
      // folder lands as a plain folder with no Insert Options, so the
      // menu is empty and authors have to use Raw API / hand-edit to
      // create a new datasource item.
      //
      // Resolution mirrors the per-slot `templateOf` path below + the
      // `RecipeDatasource` `templates[]` shape:
      //   1. component.datasource.templates[]  → all listed handles
      //   2. component.datasource.template     → single handle
      //   3. inline-`fields:` pattern          → component template itself
      // Deduped across placements so the same template GUID appears once.
      const insertOptionHandles = collectPageDataInsertOptions(recipe, context);
      if (insertOptionHandles.length > 0) {
        operations.push({
          op: "SetField",
          policy: "CreateOnly",
          label: `page-data-folder-insert-options:${recipe.handle}`,
          itemRefKey: dataFolderRefKey,
          fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
          value: {
            kind: "ref-recipe-list",
            refKeys: insertOptionHandles.map((handle) => templateId(site, handle)),
            // Standalone compile (no componentsByHandle) falls back to
            // resolving via the component handles themselves — those
            // refKeys land in the captured-itemId map when the
            // referenced templates' CreateItem ops run. In a single-
            // recipe push the referenced templates aren't part of the
            // set; tolerate so the data folder still gets created with
            // whatever Insert Options DID resolve.
            tolerateMissing: true,
          },
        } satisfies SetFieldOp);
      }

      for (const [slot, componentHandle] of scopedSlots) {
        // Resolve the component's datasource template; fall back to the
        // component template itself (the inline-`fields:` pattern, and
        // the only option for a standalone single-recipe compile).
        const component = context.componentsByHandle?.get(componentHandle);
        const datasourceTemplateHandle = component?.datasource?.template?.handle ?? componentHandle;
        operations.push({
          op: "CreateItem",
          policy,
          label: `page-datasource:${recipe.handle}:${slot}`,
          id: datasourceId(itemRefKey, slot),
          path: joinPath(dataFolderPath, slot),
          parent: { kind: "ref-recipe", refKey: dataFolderRefKey },
          templateOf: templateId(site, datasourceTemplateHandle),
          name: slot,
          fields: [
            sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
            versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: slot }),
          ],
        } satisfies CreateItemOp);
      }
    }

    const layoutXml = emitLayoutXml(recipe.layout, {
      parentItemId: itemRefKey,
      deviceId: DEFAULT_DEVICE_ID,
      renderingIdFor: (handle) => renderingId(site, handle),
      contentItemIdFor: (handle) => contentItemId(site, handle),
      // A page has a content home — scoped placements resolve against
      // the `<page>/Data/<slot>` items materialised just above.
      allowScoped: true,
      scopedDatasourceIdFor: (slot) => datasourceId(itemRefKey, slot),
      mode: "canonical",
    });
    if (layoutXml.length > 0) {
      operations.push({
        op: "SetField",
        policy,
        label: `page-layout:${recipe.handle}`,
        itemRefKey,
        fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
        language: DEFAULT_LANGUAGE,
        version: DEFAULT_VERSION,
        value: { kind: "string", value: layoutXml },
      } satisfies SetFieldOp);
    }
  }

  if (recipe.workflow) {
    operations.push({
      op: "SetField",
      policy,
      label: `page-workflow:${recipe.handle}`,
      itemRefKey,
      fieldId: deriveStandardFieldId(itemRefKey, "__Workflow"),
      fieldName: "__Workflow",
      value: { kind: "ref-recipe", refKey: workflowId(recipe.workflow) },
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
 * derivation as `compile/content-item.ts` — declared separately to keep
 * the modules independent.
 */
const STANDARD_FIELD_REFKEY_NAMESPACE = uuidv5(
  "standard-field",
  "d6c28e9f-21f3-56ee-ada3-f2a947c3d475" // NAMESPACE_ROOT
);
const deriveStandardFieldId = (parentRefKey: string, fieldName: string): string =>
  uuidv5(`${parentRefKey}:${fieldName}`, STANDARD_FIELD_REFKEY_NAMESPACE);

/**
 * Collect the deduped set of datasource template handles authors might
 * want to insert under a page's `Data` folder.
 *
 * Walks every placement on the page (not just scoped ones) and resolves
 * each component's datasource template handle via the same precedence as
 * the per-slot `templateOf`:
 *   1. `component.datasource.templates[]` — the compatible-datasources
 *      pattern; ALL listed handles contribute.
 *   2. `component.datasource.template` — single handle.
 *   3. Else (inline-`fields:` pattern, OR standalone compile with no
 *      `componentsByHandle` available) — the component template itself.
 *
 * Returns the union of handles in first-seen order, deduped. Result is
 * `[]` when no placements exist or every placement resolves to a
 * component the standalone compile can't see AND has no fallback
 * handle (which is structurally impossible — fallback is `componentHandle`
 * itself, always non-empty per `ComponentPlacementSchema`).
 */
const collectPageDataInsertOptions = (
  recipe: PageRecipe,
  context: CompileContext
): readonly string[] => {
  if (!recipe.layout) return [];
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const placements of Object.values(recipe.layout.placeholders)) {
    for (const placement of placements) {
      const component = context.componentsByHandle?.get(placement.componentHandle);
      const candidateHandles: string[] = component?.datasource?.templates?.length
        ? component.datasource.templates.map((t) => t.handle)
        : component?.datasource?.template
          ? [component.datasource.template.handle]
          : // Fallback covers two cases: (1) inline-`fields:` pattern where
            // the component template IS the datasource template; (2) standalone
            // compile (no `componentsByHandle`) where we can't see the
            // component's `datasource` block at all. In both cases the
            // component handle resolves to the right templateId.
            [placement.componentHandle];
      for (const handle of candidateHandles) {
        if (seen.has(handle)) continue;
        seen.add(handle);
        handles.push(handle);
      }
    }
  }
  return handles;
};
