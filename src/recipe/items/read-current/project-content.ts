/**
 * Content-item reverse-projection (`read-current`) — kind 10, the
 * content-bearing kind.
 *
 * Per-(language, version) field decoding via a template-field-shape map.
 * `contentItemFromItem` fans a per-language read plus a historic per-version
 * read into one round trip each, picks simple vs. story mode (the schema's
 * XOR), and fills the recipe accordingly. `walkContentItemsTree` discovers
 * the items. Shares the per-(lang, version) decoding helpers in
 * `content-helpers.ts` with the page family.
 *
 * See `../read-current.ts` for the module-level contract.
 */

import type { AuthoringApiClient, RemoteItem } from "../../api/client";
import { SYSTEM_FIELDS } from "../../ir/sitecore-templates";
import type {
  ContentItemRecipeParsed,
  ContentTranslation,
  ContentVersion,
  Recipe,
} from "../../schema/recipe";
import {
  collectSharedFields,
  dateOfSnapshot,
  decodeVersionedFieldsOf,
  fetchHistoricSnapshots,
} from "./content-helpers";
import {
  byTreeOrder,
  fieldValue,
  fieldValueByName,
  getTemplateFieldShapes,
  type GuidHandleIndex,
  handleOf,
  layoutOfSnapshot,
  normalizeGuid,
  type TemplateFieldShapes,
} from "./helpers";

/** A per-language pass-1 read row: latest snapshot + the version list. */
type LangRow = { language: string; item: RemoteItem | null; versions: number[] };

/**
 * Mode decision: story when any language carries >1 version OR any version
 * carries a layout (the simple-mode wire shape doesn't encode item-level
 * layout, so layout-bearing CIs MUST round-trip as story).
 */
const isStoryMode = (
  populated: ReadonlyArray<{ item: RemoteItem | null; versions: number[] }>,
  historicByLangVer: ReadonlyMap<string, RemoteItem>,
  guidIndex: GuidHandleIndex
): boolean => {
  if (populated.some((row) => row.versions.length > 1)) return true;
  for (const row of populated) {
    if (row.item && layoutOfSnapshot(row.item, guidIndex) !== undefined) return true;
  }
  for (const snapshot of historicByLangVer.values()) {
    if (layoutOfSnapshot(snapshot, guidIndex) !== undefined) return true;
  }
  return false;
};

/**
 * Simple mode: default-language fields, other languages → translations.
 * Mutates `base.fields` + `base.translations` and returns `base`.
 */
const fillSimpleMode = (
  base: ContentItemRecipeParsed,
  populated: ReadonlyArray<{ language: string; item: RemoteItem | null }>,
  shapes: TemplateFieldShapes,
  guidIndex: GuidHandleIndex
): ContentItemRecipeParsed => {
  const DEFAULT_LANG = "en";
  const defaultRow = populated.find((row) => row.language === DEFAULT_LANG);
  if (defaultRow?.item) {
    base.fields = decodeVersionedFieldsOf(defaultRow.item, shapes, guidIndex);
  } else {
    // No `en` populated — promote the first populated language as the
    // primary so `fields` carries content; the recipe schema requires
    // `fields` as a `Record` (defaulting to `{}` is legal but degrades
    // round-trip). The translations branch then skips that promoted lang.
    const first = populated[0];
    if (first.item) base.fields = decodeVersionedFieldsOf(first.item, shapes, guidIndex);
  }
  const primaryLang = populated.some((r) => r.language === DEFAULT_LANG)
    ? DEFAULT_LANG
    : populated[0].language;
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
 * Story mode: every (language, version) cell projects to a ContentVersion.
 * The schema requires `fields` (always present) — leave as `{}` and put all
 * content under `versions`. Mutates `base.versions` and returns `base`.
 */
const fillStoryMode = (
  base: ContentItemRecipeParsed,
  populated: ReadonlyArray<LangRow>,
  historicByLangVer: ReadonlyMap<string, RemoteItem>,
  shapes: TemplateFieldShapes,
  guidIndex: GuidHandleIndex
): ContentItemRecipeParsed => {
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
 * Reverse-project one concrete content-item into a `ContentItemRecipe` —
 * fanning per-language reads (`getItemPerLanguageBatch`) and historic
 * per-(language, version) reads (`getItemAtVersionsBatch`) into a single
 * round trip each via aliased GraphQL.
 *
 * Mode selection — simple vs. story — follows the schema's `XOR`:
 *  - **Simple**: every populated language has exactly one version AND no
 *    per-version metadata is captured (no `__Final Renderings` to recover
 *    layout from). The default language becomes `fields`; any other
 *    populated language becomes one `translations[lang]` entry.
 *  - **Story**: any populated language has versions > 1, OR any version
 *    carries a non-empty layout. Every (language, version) cell projects
 *    to one `versions[lang][n]` entry; metadata-only (no field values, no
 *    layout) versions still emit so the version stack round-trips.
 *
 * `storage: shared` fields (Sitecore fields with no language/version
 * tag) round-trip to `shared`. The compiler emits these the same way in
 * both modes, so simple and story recipes both carry them.
 *
 * Returns `null` when the item carries no template handle (`templateHandle`
 * resolved to undefined upstream) or no authorable field values in any
 * language — a content-item-shaped item with no content is not a
 * reverse-projectable recipe.
 *
 * LOSSY / omitted:
 *  - `workflow` is not recovered. The item's `__Workflow` field stores a
 *    GUID; we have no workflow→handle index (workflow recipes aren't
 *    reverse-projected), so the handle is unrecoverable.
 *  - `versions[].workflowState` and `versions[].variants` follow the
 *    same handle-resolution gap and are omitted.
 *  - `link-internal` fields whose target GUID carries no marker drop
 *    rather than synthesise a handle (`decodeContentFieldValue` returns
 *    `null`); the value is omitted from the recipe.
 *  - `image.mediaPath` round-trips verbatim — there is no media-item
 *    handle resolution (the media library is opaque to scai).
 */
const contentItemFromItem = async ({
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
}): Promise<ContentItemRecipeParsed | null> => {
  if (tenantLanguages.length === 0) return null;

  const shapes = await getTemplateFieldShapes(item.templateId, client, templateShapeCache);

  // Pass 1 — per-language latest-version read. One round trip total.
  const perLang = await client.getItemPerLanguageBatch({ itemId: item.itemId }, tenantLanguages);
  const populated = perLang.filter((row) => row.item !== null && row.versions.length > 0);
  if (populated.length === 0) return null;

  // Pass 2 — historic versions (any populated language with versions > 1).
  // Skip pass 2 entirely when every language is single-version.
  const historicByLangVer = await fetchHistoricSnapshots(item, populated, client);

  const sharedFields = collectSharedFields(populated, shapes, guidIndex);

  const isStory = isStoryMode(populated, historicByLangVer, guidIndex);

  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");

  const base: ContentItemRecipeParsed = {
    kind: "content-item",
    schemaVersion: "1",
    handle: handleOf(item),
    name: item.name,
    displayName,
    templateType: templateHandle,
    // Filled below per mode — Zod schemas default `fields` to `{}` even when
    // a `versions` story takes over, so the field is always present.
    fields: {},
  };
  if (description !== undefined && description !== "") base.description = description;
  if (Object.keys(sharedFields).length > 0) base.shared = sharedFields;

  return isStory
    ? fillStoryMode(base, populated, historicByLangVer, shapes, guidIndex)
    : fillSimpleMode(base, populated, shapes, guidIndex);
};

/**
 * Walk the content-items root recursively, reverse-projecting every item
 * whose template GUID resolves through the marker index into a
 * `ContentItemRecipe`. Items whose template carries no marker (genuinely
 * OOTB, or authored outside scai) are silently skipped — there is no
 * `templateType` handle to emit.
 *
 * Recurses into nested folders (a content-items bucket commonly has
 * grouping sub-folders authors create); `__Standard Values` children are
 * skipped. The walk surfaces `ContentItemRecipe`s in tree order.
 */
export const walkContentItemsTree = async (
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
    const children = (await client.getChildren({ itemId: parent.itemId }))
      .filter((c) => c.name !== "__Standard Values")
      .sort(byTreeOrder);
    for (const child of children) {
      const templateHandle = guidIndex.get(normalizeGuid(child.templateId));
      if (templateHandle !== undefined) {
        const recipe = await contentItemFromItem({
          item: child,
          templateHandle,
          client,
          guidIndex,
          templateShapeCache,
          tenantLanguages,
        });
        if (recipe) recipes.push(recipe);
        // Fall through — a content item can carry child folders (e.g.,
        // a story's Data slots). Descend so nested content items reverse-
        // project too.
      }
      await visit(child);
    }
  };
  await visit(root);
  return recipes;
};
