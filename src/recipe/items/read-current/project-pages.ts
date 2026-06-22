/**
 * Layout-bearing reverse-projection (`read-current`).
 *
 * The kinds whose fidelity hinges on parsing Sitecore layout XML back into
 * the recipe `Layout`:
 *   - partial-design, page-design (SXA composition items)
 *   - page (a concrete page item, per-(language, version) fan-out)
 *   - placeholder (Placeholder Settings item)
 *
 * Plus the four tree walkers that discover these items. `pageFromItem` and
 * `walkPagesTree` reuse the content-bearing helpers in `content-helpers.ts`
 * (the page per-(lang, version) fan-out is the same shape as a content item's).
 *
 * See `../read-current.ts` for the module-level contract.
 */

import type { AuthoringApiClient, RemoteItem } from "../../api/client";
import {
  COMPOSITION_FIELDS,
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_TEMPLATE_ID,
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../../ir/sitecore-templates";
import type {
  ContentTranslation,
  ContentVersion,
  PageDesignRecipeParsed,
  PageRecipeParsed,
  PartialDesignRecipeParsed,
  PlaceholderRecipeParsed,
  Recipe,
} from "../../schema/recipe";
import { decodeTemplatesMapping } from "./decode";
import {
  collectSharedFields,
  dateOfSnapshot,
  decodeVersionedFieldsOf,
  fetchHistoricSnapshots,
} from "./content-helpers";
import {
  byTreeOrder,
  conformsTo,
  fieldValue,
  fieldValueByName,
  finalLayoutXmlOf,
  getTemplateFieldShapes,
  type GuidHandleIndex,
  handleOf,
  layoutFromXml,
  layoutOfSnapshot,
  normalizeGuid,
  sharedLayoutXmlOf,
  type TemplateFieldShapes,
} from "./helpers";

/** A per-language pass-1 read row: latest snapshot + the version list. */
type LangRow = { language: string; item: RemoteItem | null; versions: number[] };

/**
 * Reverse-project one SXA Partial Design item into a `PartialDesignRecipe`.
 *
 * Faithful: `name`, `displayName` (`__Display name`, default `name`),
 * `description`, `icon`, and the `layout` — parsed from the item's
 * `__Renderings` field (delta wire form; `parseLayoutXml` handles it) and
 * resolved against the marker index.
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker or synthesised from
 * `name` (see `handleOf`). Layout placements whose rendering GUID carries
 * no marker are dropped (see `placementFromParsed`) — the partial still
 * reverse-projects, just without those placements.
 */
const partialDesignFromItem = (
  item: RemoteItem,
  guidIndex: GuidHandleIndex
): PartialDesignRecipeParsed => {
  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");
  const icon = fieldValue(item, SYSTEM_FIELDS.ICON, "__Icon");

  const recipe: PartialDesignRecipeParsed = {
    kind: "partial-design",
    schemaVersion: "1",
    handle: handleOf(item),
    name: item.name,
    displayName,
    layout: layoutFromXml(sharedLayoutXmlOf(item), guidIndex),
  };
  if (description !== undefined && description !== "") recipe.description = description;
  if (icon !== undefined && icon !== "") recipe.icon = icon;
  return recipe;
};

/**
 * Reverse-project one SXA Page Design item into a `PageDesignRecipe`.
 *
 * Faithful: `name`, `displayName`, `description`, `icon`, `partials`
 * (the `PartialDesigns` field's pipe-separated GUID list, each resolved
 * via the marker index), and `layout` (the design's own `__Renderings`,
 * usually empty).
 *
 * `appliesTo`: RECOVERED — but from the *Page Designs root's*
 * `TemplatesMapping` field, NOT the design item. `TemplatesMapping` is a
 * cross-recipe aggregate on the root (`{tplGuid}={designGuid}&…`); the
 * caller decodes it once, finds every entry whose `designGuid` is this
 * design, and threads the resolved page-template handles in here. When the
 * root carries no mapping (or none points at this design) `appliesTo` is
 * left at its schema default `[]`.
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker or synthesised.
 * A `partials[]` GUID with no marker, or a layout placement whose
 * rendering GUID has no marker, is dropped.
 */
const pageDesignFromItem = (
  item: RemoteItem,
  appliesTo: string[],
  guidIndex: GuidHandleIndex
): PageDesignRecipeParsed => {
  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");
  const icon = fieldValue(item, SYSTEM_FIELDS.ICON, "__Icon");

  // `PartialDesigns` — pipe-separated GUID list; resolve each via the
  // marker index, dropping any GUID that carries no marker.
  const partialsRaw = fieldValue(item, COMPOSITION_FIELDS.PARTIAL_DESIGNS, "PartialDesigns");
  const partials: string[] = [];
  if (partialsRaw !== undefined && partialsRaw.trim() !== "") {
    for (const guid of partialsRaw.split("|")) {
      const handle = guidIndex.get(normalizeGuid(guid));
      if (handle !== undefined) partials.push(handle);
    }
  }

  const recipe: PageDesignRecipeParsed = {
    kind: "page-design",
    schemaVersion: "1",
    handle: handleOf(item),
    name: item.name,
    displayName,
    appliesTo,
    partials,
  };
  if (description !== undefined && description !== "") recipe.description = description;
  if (icon !== undefined && icon !== "") recipe.icon = icon;

  // The design's own layout — most designs leave it empty. Only carry a
  // non-empty layout (schema makes it optional; an empty one is omitted).
  const layout = layoutFromXml(sharedLayoutXmlOf(item), guidIndex);
  if (Object.keys(layout.placeholders).length > 0) recipe.layout = layout;
  return recipe;
};

/**
 * Single-language fallback for the rare path where multi-language fan-out
 * yields nothing (zero populated languages — degenerate item) or the
 * tenant-language fetch returned an empty set. Keeps the historic
 * single-language behaviour (`__Final Renderings` decoded from the item's
 * default fields) so the recipe still has a layout to round-trip.
 */
const pageFromItemLegacy = (
  item: RemoteItem,
  templateHandle: string,
  guidIndex: GuidHandleIndex
): PageRecipeParsed => {
  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");
  const recipe: PageRecipeParsed = {
    kind: "page",
    schemaVersion: "1",
    handle: handleOf(item),
    name: item.name,
    displayName,
    template: templateHandle,
    fields: {},
  };
  if (description !== undefined && description !== "") recipe.description = description;
  const layout = layoutFromXml(finalLayoutXmlOf(item), guidIndex);
  if (Object.keys(layout.placeholders).length > 0) recipe.layout = layout;
  return recipe;
};

/**
 * Page simple mode: default-language fields + per-language translations.
 * Unlike a content item, a page's simple mode CAN carry an item-level
 * layout (the schema supports it) — captured from the primary row's
 * `__Final Renderings`. Mutates `base` and returns it.
 */
const fillPageSimpleMode = (
  base: PageRecipeParsed,
  populated: ReadonlyArray<{ language: string; item: RemoteItem | null }>,
  shapes: TemplateFieldShapes,
  guidIndex: GuidHandleIndex
): PageRecipeParsed => {
  const DEFAULT_LANG = "en";
  const primaryRow = populated.find((row) => row.language === DEFAULT_LANG) ?? populated[0];
  const primaryLang = primaryRow.language;
  if (primaryRow.item) {
    base.fields = decodeVersionedFieldsOf(primaryRow.item, shapes, guidIndex);
    const primaryLayout = layoutOfSnapshot(primaryRow.item, guidIndex);
    if (primaryLayout !== undefined) base.layout = primaryLayout;
  }
  const translations: Record<string, ContentTranslation> = {};
  for (const row of populated) {
    if (row.language === primaryLang) continue;
    if (!row.item) continue;
    const fields = decodeVersionedFieldsOf(row.item, shapes, guidIndex);
    if (Object.keys(fields).length > 0) translations[row.language] = { fields };
  }
  if (Object.keys(translations).length > 0) base.translations = translations;
  return base;
};

/**
 * Page story mode: every (language, version) cell becomes a ContentVersion
 * entry carrying its own fields + per-version layout. `fields` stays empty
 * per the simple-vs-story XOR. Mutates `base.versions` and returns `base`.
 */
const fillPageStoryMode = (
  base: PageRecipeParsed,
  populated: ReadonlyArray<LangRow>,
  historicByLangVer: ReadonlyMap<string, RemoteItem>,
  shapes: TemplateFieldShapes,
  guidIndex: GuidHandleIndex
): PageRecipeParsed => {
  const versions: Record<string, ContentVersion[]> = {};
  for (const row of populated) {
    const entries: ContentVersion[] = [];
    for (const v of row.versions) {
      const isLatest = v === row.versions[row.versions.length - 1];
      const snapshot = isLatest ? row.item : historicByLangVer.get(`${row.language}|${v}`);
      if (!snapshot) continue;
      const entry: ContentVersion = {
        version: v,
        fields: decodeVersionedFieldsOf(snapshot, shapes, guidIndex),
      };
      const date = dateOfSnapshot(snapshot);
      if (date !== undefined) entry.date = date;
      const layout = layoutOfSnapshot(snapshot, guidIndex);
      if (layout !== undefined) entry.layout = layout;
      entries.push(entry);
    }
    if (entries.length > 0) versions[row.language] = entries;
  }
  if (Object.keys(versions).length > 0) base.versions = versions;
  return base;
};

/**
 * Reverse-project one page item into a `PageRecipe` — same per-(language,
 * version) fan-out pattern as `contentItemFromItem`, adapted for pages.
 *
 * Mode selection mirrors `ContentItemRecipe`:
 *  - **Simple**: every populated language has exactly one version. The
 *    default-language fields become `recipe.fields`; other populated
 *    languages become `recipe.translations`. The item-level `layout`
 *    captures `__Final Renderings` from the default-language v1 (the
 *    simple-mode wire-shape contract has each translation sharing the
 *    same layout — only story mode encodes per-language layouts).
 *  - **Story**: any populated language has > 1 version. Every (language,
 *    version) cell projects to a `versions[lang][n]` entry carrying its
 *    own fields + per-version layout. Item-level `layout` is forbidden
 *    in story mode (the compile-side XOR also enforces this).
 *
 * `template`: RECOVERED via the marker index — the page item conforms to
 * a page template, and its `templateId` resolves to that template's
 * handle. When the template GUID carries no marker the page can't
 * reverse-project (a `PageRecipe` REQUIRES a `template`), so the caller
 * skips it — see `walkPagesTree`.
 *
 * `scoped` datasources: a layout placement whose `ds` GUID is a
 * `<page>/Data/<slot>` child is recovered as `kind: "scoped"` only via the
 * `local:<slot>` sentinel that `emitLayoutXml` writes when no resolver was
 * available. A scoped placement that was compiled with a resolver carries
 * a real GUID instead; that GUID resolves through the marker index the
 * same as a shared one, so it reverse-projects as `kind: "shared"` — an
 * accepted v1 lossiness (the datasource still resolves to the right item).
 *
 * LOSSY / omitted:
 *  - `handle` is the `Scai Handle` marker or synthesised.
 *  - `workflow` is not recovered (no workflow→handle index).
 *  - `versions[].workflowState` / `versions[].variants` follow the same
 *    handle-resolution gap and are omitted.
 *  - `link-internal` fields whose target GUID has no marker drop.
 */
const pageFromItem = async ({
  item,
  templateHandle,
  client,
  guidIndex,
  templateShapeCache,
  tenantLanguages,
}: {
  item: RemoteItem;
  templateHandle: string;
  client: AuthoringApiClient;
  guidIndex: GuidHandleIndex;
  templateShapeCache: Map<string, TemplateFieldShapes>;
  tenantLanguages: readonly string[];
}): Promise<PageRecipeParsed | null> => {
  if (tenantLanguages.length === 0) {
    // Defensive — when getTenantLanguages's fallback is empty, leave the
    // historic single-language projection in place.
    return pageFromItemLegacy(item, templateHandle, guidIndex);
  }

  const shapes = await getTemplateFieldShapes(item.templateId, client, templateShapeCache);

  // Pass 1 — per-language latest-version read.
  const perLang = await client.getItemPerLanguageBatch({ itemId: item.itemId }, tenantLanguages);
  const populated = perLang.filter((row) => row.item !== null && row.versions.length > 0);
  if (populated.length === 0) {
    // Item has no language version — fall back to the legacy projection
    // (the item still has shared fields + maybe a layout we can read).
    return pageFromItemLegacy(item, templateHandle, guidIndex);
  }

  // Pass 2 — historic per-(lang, version) reads when any language has > 1
  // version. Skipped entirely when every populated language is single-version.
  const historicByLangVer = await fetchHistoricSnapshots(item, populated, client);

  const sharedFields = collectSharedFields(populated, shapes, guidIndex);

  // Mode decision: story when any populated language has > 1 version.
  // Unlike content items, pages' simple mode CAN carry an item-level
  // layout (the schema supports it), so a single-version multi-language
  // page with a layout still round-trips as simple mode.
  const isStory = populated.some((row) => row.versions.length > 1);

  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");

  const base: PageRecipeParsed = {
    kind: "page",
    schemaVersion: "1",
    handle: handleOf(item),
    name: item.name,
    displayName,
    template: templateHandle,
    fields: {},
  };
  if (description !== undefined && description !== "") base.description = description;
  if (Object.keys(sharedFields).length > 0) base.shared = sharedFields;

  return isStory
    ? fillPageStoryMode(base, populated, historicByLangVer, shapes, guidIndex)
    : fillPageSimpleMode(base, populated, shapes, guidIndex);
};

/**
 * Reverse-project one SXA Placeholder Settings item into a
 * `PlaceholderRecipe`.
 *
 * Faithful: `name`, `displayName` (`__Display name`, default `name`),
 * `description`, `icon`, and `key` — the `Placeholder Key` field, which is
 * the item's load-bearing identity.
 *
 * `allowedComponents`: BEST-EFFORT — the `Allowed Controls` field is a
 * pipe-separated list of *rendering* GUIDs; each is resolved to a
 * component handle via the marker index, and any GUID with no marker is
 * dropped. The list therefore round-trips only the controls scai itself
 * placed (a hand-authored Allowed Controls entry pointing at an unmarked
 * OOTB rendering is silently lost) — acceptable per the lossy contract.
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker or synthesised
 * from `name`. `folder` (the grouping path under the placeholder settings
 * root) is reconstructed by the caller from the folders the item sits
 * under. `dynamic` is not recoverable from a Placeholder Settings item
 * alone — it is left at its schema default `false`.
 *
 * Returns `null` when the item carries no `Placeholder Key` — a
 * `PlaceholderRecipe` REQUIRES a non-empty `key`, and a key-less
 * Placeholder Settings item is not reverse-projectable.
 */
const placeholderFromItem = (
  item: RemoteItem,
  folderSegments: string[],
  guidIndex: GuidHandleIndex
): PlaceholderRecipeParsed | null => {
  const key = fieldValue(item, PLACEHOLDER_FIELDS.PLACEHOLDER_KEY, "Placeholder Key");
  if (key === undefined || key.trim() === "") {
    // No Placeholder Key — schema requires `key.min(1)`. Skip.
    return null;
  }

  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");
  const icon = fieldValue(item, SYSTEM_FIELDS.ICON, "__Icon");

  // `Allowed Controls` — pipe-separated rendering GUIDs; resolve each via
  // the marker index, dropping any GUID that carries no marker.
  const allowedRaw = fieldValue(item, PLACEHOLDER_FIELDS.ALLOWED_CONTROLS, "Allowed Controls");
  const allowedComponents: string[] = [];
  if (allowedRaw !== undefined && allowedRaw.trim() !== "") {
    for (const guid of allowedRaw.split("|")) {
      const handle = guidIndex.get(normalizeGuid(guid));
      if (handle !== undefined) allowedComponents.push(handle);
    }
  }

  const recipe: PlaceholderRecipeParsed = {
    kind: "placeholder",
    schemaVersion: "1",
    handle: handleOf(item),
    key: key.trim(),
    name: item.name,
    displayName,
    dynamic: false,
    allowedComponents,
  };
  if (description !== undefined && description !== "") recipe.description = description;
  if (icon !== undefined && icon !== "") recipe.icon = icon;
  if (folderSegments.length > 0) recipe.folder = folderSegments;
  return recipe;
};

/**
 * Walk the Partial Designs root, reverse-projecting every SXA Partial
 * Design item into a `PartialDesignRecipe`. Partial designs sit flat
 * directly under the root (the partial-design compiler parents them at
 * `joinPath(partialDesignsRoot, recipe.name)`); a child that doesn't
 * conform to the Partial Design template is skipped silently.
 */
export const walkPartialDesignsTree = async (
  rootPath: string,
  client: AuthoringApiClient,
  guidIndex: GuidHandleIndex
): Promise<Recipe[]> => {
  const recipes: Recipe[] = [];
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return recipes;

  const children = (await client.getChildren({ itemId: root.itemId })).sort(byTreeOrder);
  for (const child of children) {
    if (conformsTo(child, SITECORE_TEMPLATES.PARTIAL_DESIGN)) {
      recipes.push(partialDesignFromItem(child, guidIndex));
    }
  }
  return recipes;
};

/**
 * Walk the Page Designs root, reverse-projecting every SXA Page Design
 * item into a `PageDesignRecipe`.
 *
 * `appliesTo` is recovered from the root's own `TemplatesMapping` field:
 * the field is decoded once up front into design-GUID → template-handles
 * groupings, and each page design's slice is threaded into
 * `pageDesignFromItem`. A template GUID in the mapping with no marker is
 * dropped from `appliesTo` (unrecoverable handle).
 */
export const walkPageDesignsTree = async (
  rootPath: string,
  client: AuthoringApiClient,
  guidIndex: GuidHandleIndex
): Promise<Recipe[]> => {
  const recipes: Recipe[] = [];
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return recipes;

  // Decode the root's TemplatesMapping into `designGuid → [templateHandle]`.
  const mappingRaw = fieldValue(root, COMPOSITION_FIELDS.TEMPLATES_MAPPING, "TemplatesMapping");
  const appliesToByDesign = new Map<string, string[]>();
  if (mappingRaw !== undefined && mappingRaw.trim() !== "") {
    for (const { templateGuid, designGuid } of decodeTemplatesMapping(mappingRaw)) {
      const templateHandle = guidIndex.get(templateGuid);
      if (templateHandle === undefined) continue; // unrecoverable handle
      const list = appliesToByDesign.get(designGuid) ?? [];
      list.push(templateHandle);
      appliesToByDesign.set(designGuid, list);
    }
  }

  const children = (await client.getChildren({ itemId: root.itemId })).sort(byTreeOrder);
  for (const child of children) {
    if (conformsTo(child, SITECORE_TEMPLATES.PAGE_DESIGN)) {
      const appliesTo = appliesToByDesign.get(normalizeGuid(child.itemId)) ?? [];
      recipes.push(pageDesignFromItem(child, appliesTo, guidIndex));
    }
  }
  return recipes;
};

/**
 * Walk the pages root, reverse-projecting every page item into a
 * `PageRecipe`.
 *
 * A "page" here is any child whose `templateId` resolves — through the
 * marker index — to a page-template handle: page items conform to a page
 * template, and `pageFromItem` needs that handle for the recipe's required
 * `template` field. A child whose template GUID carries no marker is
 * skipped (its template is unrecoverable, so the page can't reverse-
 * project). The page's own `Data` datasource folder is skipped — it is a
 * generic Folder, not a page.
 *
 * Recurses one level into child pages (page-tree nesting): a page item's
 * children that are themselves pages reverse-project too. The `Data`
 * folder is not descended into.
 */
export const walkPagesTree = async (
  rootPath: string,
  client: AuthoringApiClient,
  guidIndex: GuidHandleIndex,
  templateShapeCache: Map<string, TemplateFieldShapes>,
  tenantLanguages: readonly string[]
): Promise<Recipe[]> => {
  const recipes: Recipe[] = [];
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return recipes;

  const visit = async (parent: RemoteItem): Promise<void> => {
    const children = (await client.getChildren({ itemId: parent.itemId })).sort(byTreeOrder);
    for (const child of children) {
      if (child.name === "Data" || child.name === "__Standard Values") continue;
      const templateHandle = guidIndex.get(normalizeGuid(child.templateId));
      if (templateHandle === undefined) {
        // Template GUID carries no marker — the page's template is
        // unrecoverable, so the page can't reverse-project. Skip.
        continue;
      }
      const recipe = await pageFromItem({
        item: child,
        templateHandle,
        client,
        guidIndex,
        templateShapeCache,
        tenantLanguages,
      });
      if (recipe) recipes.push(recipe);
      await visit(child);
    }
  };
  await visit(root);
  return recipes;
};

/**
 * Walk the Placeholder Settings root, reverse-projecting every Placeholder
 * Settings item into a `PlaceholderRecipe`.
 *
 * Items conforming to `PLACEHOLDER_TEMPLATE_ID` are leaves; folders (any
 * other item with children) are grouping folders — recursed into, with the
 * cumulative folder path threaded onto each placeholder's `folder`. A
 * key-less Placeholder Settings item is skipped (`placeholderFromItem`
 * returns `null`).
 */
export const walkPlaceholderSettingsTree = async (
  rootPath: string,
  client: AuthoringApiClient,
  guidIndex: GuidHandleIndex
): Promise<Recipe[]> => {
  const recipes: Recipe[] = [];
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return recipes;

  // `folderSegments` carries the grouping-folder path as `string[]` so
  // reverse-projected placeholder recipes emit the canonical array
  // shape that schemas/recipe.ts's `FolderPath` accepts.
  const visit = async (parent: RemoteItem, folderSegments: string[]): Promise<void> => {
    const children = (await client.getChildren({ itemId: parent.itemId }))
      .filter((c) => c.name !== "__Standard Values")
      .sort(byTreeOrder);
    for (const child of children) {
      if (conformsTo(child, PLACEHOLDER_TEMPLATE_ID)) {
        const recipe = placeholderFromItem(child, folderSegments, guidIndex);
        if (recipe) recipes.push(recipe);
        continue;
      }
      // Anything that isn't a Placeholder leaf is a grouping folder —
      // descend, extending the cumulative segment list.
      await visit(child, [...folderSegments, child.name]);
    }
  };
  await visit(root, []);
  return recipes;
};
