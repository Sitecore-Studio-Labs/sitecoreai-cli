/**
 * Shared leaf helpers for the reverse-projection (`read-current`).
 *
 * GUID/field accessors, handle recovery, sort ordering, the Sitecore
 * field-type ⇄ abstract-shape inverse maps, single-field reverse-projection,
 * the per-template field-shape walker, the GUID→handle marker index, and the
 * layout-XML helpers. These are the cohesive utilities every per-kind
 * projector and walker shares — pure functions plus a couple of async
 * client-driven walks, no per-kind recipe knowledge.
 *
 * See `../read-current.ts` for the module-level contract.
 */

import type { AuthoringApiClient, RemoteItem } from "../../api/client";
import {
  LAYOUT_FIELDS,
  SITECORE_TEMPLATES,
  SXA_COMPONENT_BASE_TEMPLATES,
  SXA_HEADLESS_PAGE_BASE_TEMPLATES,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../../ir/sitecore-templates";
import { parseLayoutXml, type ParsedPlacement } from "../../layout/parse";
import type {
  ComponentPlacement,
  FieldDefinition,
  Layout,
  SitecoreFieldAugment,
} from "../../schema/recipe";
import { HANDLE_PATTERN } from "../../schema/recipe";
import type { FieldShape, SitecoreFieldType } from "../../schema/field-types";
import { sitecoreFieldTypeLabel } from "../../schema/field-types";
import { SCAI_HANDLE_FIELD_NAME } from "../marker";

// ───────────────────────────────────────────────────────────────────────────
// GUID + field accessors
// ───────────────────────────────────────────────────────────────────────────

/**
 * Normalise a Sitecore GUID for comparison: lowercase, strip curly braces
 * and hyphens. The Authoring API returns GUIDs hyphen-less
 * (`1930bbeb7805471a…`) while the built-in template constants are
 * hyphenated — normalising both sides to the bare 32-hex form is what makes
 * `conformsTo` / `guidEquals` actually match against a live tenant.
 */
export const normalizeGuid = (guid: string): string =>
  guid.trim().toLowerCase().replace(/[{}-]/g, "");

/** True when two Sitecore GUIDs refer to the same item (curly/case-insensitive). */
export const guidEquals = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && normalizeGuid(a) === normalizeGuid(b);

/**
 * Look up a field value on a `RemoteItem` by field GUID OR field name. The
 * compiler emits some fields by GUID and some by name; reverse-projection
 * matches on either so it stays robust against the GUID/name split the
 * executor's resolver papers over (see `RemoteFieldValue.name`).
 */
export const fieldValue = (
  item: RemoteItem,
  fieldId: string,
  fieldName?: string
): string | undefined => {
  const byId = item.fields.find((f) => guidEquals(f.fieldId, fieldId));
  if (byId) return byId.value;
  if (fieldName) {
    const byName = item.fields.find(
      (f) => f.name !== undefined && f.name.toLowerCase() === fieldName.toLowerCase()
    );
    if (byName) return byName.value;
  }
  return undefined;
};

/** Find a field value by field NAME only (case-insensitive). */
export const fieldValueByName = (item: RemoteItem, fieldName: string): string | undefined => {
  const match = item.fields.find(
    (f) => f.name !== undefined && f.name.toLowerCase() === fieldName.toLowerCase()
  );
  return match?.value;
};

/** True when the item conforms to the given Sitecore built-in template. */
export const conformsTo = (item: RemoteItem, templateId: string): boolean =>
  guidEquals(item.templateId, templateId);

// ───────────────────────────────────────────────────────────────────────────
// Handle recovery + ordering
// ───────────────────────────────────────────────────────────────────────────

/**
 * Synthesise a recipe `handle` (`<kebab-name>@<major>`) from an item name.
 * The fallback for *unmarked* items only — see `handleOf`. We kebab-case the
 * item name and pin major version `1`.
 *
 * LOSSY: if the original recipe handle differed from `kebab(name)@1` (e.g.
 * a `@2` major, or a handle that doesn't track the name), the round-trip
 * produces a different handle — and therefore different derived GUIDs.
 * Acceptable for v1: a synthesised handle is only ever used for an item the
 * `Scai Handle` marker didn't cover (an environment scai never pushed to, or
 * an item authored outside scai), and a pulled recipe is re-authored
 * material, not a byte-exact mirror.
 */
const handleFromName = (name: string): string => {
  const kebab = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  // Handles must match /^[a-z][a-z0-9-]*@[0-9]+$/ — guard a leading digit.
  const safe = /^[a-z]/.test(kebab) ? kebab : `x-${kebab}`;
  return `${safe || "item"}@1`;
};

/**
 * Recover an item's recipe handle — its stable identity.
 *
 * Recovery rule:
 *   1. Tenant-stamped `Scai Handle` marker (preferred, but TRUSTED ONLY
 *      IF SHAPE-VALID — see security note below).
 *   2. Synthesise from the item name (fallback for unmarked items).
 *
 * Prefers the `Scai Handle` marker field, which carries the *exact* handle
 * `push` stamped on every recipe-managed item: a marked item round-trips to
 * the author's real handle regardless of how the item was later moved or
 * renamed. Falls back to synthesising one from the item name
 * (`handleFromName`) only for unmarked items — a first capture of an
 * environment scai never pushed to, or items created outside scai.
 *
 * SECURITY: the `Scai Handle` field is tenant-controlled — any author
 * with write access to the item can set it to an arbitrary string.
 * Downstream consumers (`writeRecipeJson`, `FileBaselineStorage.locator`)
 * fold the handle into a filesystem path via `slugifyHandle`, which only
 * replaces `@` with `_v` — it does NOT strip path separators or `..`
 * segments. A malicious handle like `"../../tmp/pwn@1"` would resolve
 * outside the operator's output directory.
 *
 * Defence: validate the marker against `HANDLE_PATTERN`
 * (`/^[a-z][a-z0-9-]*@[0-9]+$/`) before trusting it. The pattern
 * forbids `/`, `\`, `.`, leading dot, uppercase — so a tampered marker
 * is rejected and we fall back to `handleFromName`, which builds a
 * deterministic kebab handle from the item's Sitecore name (also
 * subject to Sitecore's own item-naming rules; safe).
 *
 * See `marker.ts` and docs/recipe-sync-architecture.md, "Recipe identity".
 */
export const handleOf = (item: RemoteItem): string => {
  const marked = fieldValueByName(item, SCAI_HANDLE_FIELD_NAME);
  if (marked !== undefined) {
    const trimmed = marked.trim();
    if (trimmed !== "" && HANDLE_PATTERN.test(trimmed)) return trimmed;
    // Malformed marker — silently fall back. Logging is intentionally
    // omitted to keep the read path quiet on noisy tenants; the
    // resulting handle differs from the marker's intent, but that's
    // strictly safer than honouring an attacker-controlled string.
  }
  return handleFromName(item.name);
};

/** Sitecore stores child sort order; default 0 when absent. */
const sortOrderOf = (item: RemoteItem): number => {
  const raw = fieldValue(item, SYSTEM_FIELDS.SORT_ORDER, "__Sortorder");
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
};

/** Stable child ordering: Sitecore sort order, then name as a tiebreak. */
export const byTreeOrder = (a: RemoteItem, b: RemoteItem): number => {
  const so = sortOrderOf(a) - sortOrderOf(b);
  return so !== 0 ? so : a.name.localeCompare(b.name);
};

// ───────────────────────────────────────────────────────────────────────────
// Sitecore field-type ⇄ abstract-shape inverse maps
// ───────────────────────────────────────────────────────────────────────────

/**
 * Inverse of `sitecoreFieldTypeLabel` — the stored `Type` string
 * (`"Single-Line Text"`, `"Rich Text"`, …) back to its `SitecoreFieldType`
 * token. Returns `undefined` for an unrecognised label.
 */
const SITECORE_TYPES: readonly SitecoreFieldType[] = [
  "single-line-text",
  "multi-line-text",
  "rich-text",
  "image",
  "file",
  "general-link",
  "checkbox",
  "number",
  "integer",
  "date",
  "datetime",
  "droplist",
  "droplink",
  "treelist",
  "treelist-with-search",
  "lookup",
  "tags",
];

export const sitecoreTypeFromLabel = (label: string): SitecoreFieldType | undefined => {
  const target = label.trim().toLowerCase();
  return SITECORE_TYPES.find((t) => sitecoreFieldTypeLabel(t).toLowerCase() === target);
};

/**
 * Sitecore field type → abstract `FieldShape`. Inverts
 * `defaultSitecoreFieldType`. A static lookup table replaces the former
 * `switch`: the forward map is many-to-one in places, so the inverse picks
 * the canonical shape (e.g. `droplink → reference`). The raw type is always
 * preserved verbatim on `sitecore.type`, so the field still compiles to the
 * exact same Sitecore type regardless of the abstract shape chosen here.
 *
 * `Plugin` maps to `text`: the stored value is a string (digest or JSON blob
 * the plugin postMessages back via `setValue`); the plugin identity lives in
 * the field's Source, recovered separately by source-detection logic.
 */
const SHAPE_BY_SITECORE_TYPE: Record<SitecoreFieldType, FieldShape> = {
  "single-line-text": "text",
  "multi-line-text": "text",
  "rich-text": "richText",
  image: "image",
  file: "image",
  "general-link": "link",
  checkbox: "boolean",
  number: "number",
  integer: "integer",
  date: "date",
  datetime: "datetime",
  droplist: "enum",
  droplink: "reference",
  treelist: "reference",
  "treelist-with-search": "reference",
  lookup: "reference",
  tags: "reference",
  Plugin: "text",
};

/**
 * Map a stored Sitecore field type back to the recipe's abstract
 * `FieldShape`. Falls back to `"text"` for any unmapped value so an unknown
 * type never crashes the read path.
 */
export const shapeFromSitecoreType = (type: SitecoreFieldType): FieldShape =>
  SHAPE_BY_SITECORE_TYPE[type] ?? "text";

// ───────────────────────────────────────────────────────────────────────────
// Single-field reverse-projection
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reverse-project a single `TEMPLATE_FIELD` item into a `FieldDefinition`.
 *
 * Faithful: field `name`, the Sitecore `Type` (carried verbatim on
 * `sitecore.type`), the section it lives under (`sitecore.section`),
 * `sitecore.sortOrder`, and the storage axis (`sitecore.storage`, recovered
 * from the field's `Shared` / `Unversioned` flags). The `Source` value is
 * preserved verbatim via `sitecore.source = { kind: "raw", value }` —
 * the structured `filter` decomposition (`types`/`query`/`scope`) is
 * intentionally NOT reverse-engineered (it would require parsing the
 * URL-encoded Source and resolving GUIDs back to recipe handles);
 * `kind: "raw"` round-trips to the identical wire string.
 *
 * LOSSY / omitted: `required`, `hint`, `default`, `enumHandle`, and the
 * abstract `multiple` flag are not recoverable from a field item alone and
 * are omitted. The abstract `shape` is a best-effort inverse of the stored
 * `Type` — see `shapeFromSitecoreType`.
 */
export const fieldFromItem = (fieldItem: RemoteItem, sectionName: string): FieldDefinition => {
  const typeLabel = fieldValue(fieldItem, TEMPLATE_FIELD_FIELDS.TYPE, "Type");
  const sitecoreType = typeLabel ? sitecoreTypeFromLabel(typeLabel) : undefined;
  const shape: FieldShape = sitecoreType ? shapeFromSitecoreType(sitecoreType) : "text";

  const augment: SitecoreFieldAugment = {};
  // Carry the exact Sitecore type so the field compiles back to the same
  // type even when the abstract shape inverse is imperfect.
  if (sitecoreType) augment.type = sitecoreType;

  const source = fieldValue(fieldItem, TEMPLATE_FIELD_FIELDS.SOURCE, "Source");
  if (source !== undefined && source !== "") {
    // Verbatim round-trip: `source: { kind: "raw", value }` re-emits
    // the identical Source string at compile time.
    augment.source = { kind: "raw", value: source };
  }

  // Field storage axis — `Shared` / `Unversioned` are shared flags on the
  // field item. `versioned` is the Sitecore default; omit it rather than
  // fabricate, so the round-trip stays clean.
  if (fieldValue(fieldItem, TEMPLATE_FIELD_FIELDS.SHARED, "Shared") === "1") {
    augment.storage = "shared";
  } else if (fieldValue(fieldItem, TEMPLATE_FIELD_FIELDS.UNVERSIONED, "Unversioned") === "1") {
    augment.storage = "unversioned";
  }

  const sortOrderRaw = fieldValue(fieldItem, SYSTEM_FIELDS.SORT_ORDER, "__Sortorder");
  if (sortOrderRaw !== undefined) {
    const n = Number.parseInt(sortOrderRaw, 10);
    if (Number.isFinite(n)) augment.sortOrder = n;
  }

  // Section is meaningful for `fields` (component/content templates); the
  // compiler defaults it to "Content", so omit it when it matches.
  if (sectionName && sectionName !== "Content") {
    augment.section = sectionName;
  }

  const definition: FieldDefinition = { name: fieldItem.name, shape };
  if (Object.keys(augment).length > 0) {
    definition.sitecore = augment;
  }
  return definition;
};

/**
 * Walk a template item's `TEMPLATE_SECTION` children and reverse-project
 * every `TEMPLATE_FIELD` leaf under them into ordered `FieldDefinition`s.
 *
 * `__Standard Values` children are skipped — they're not sections. Sections
 * and fields are emitted in Sitecore sort order so the round-trip preserves
 * authored ordering.
 */
export const fieldsOfTemplate = async (
  templateItem: RemoteItem,
  client: AuthoringApiClient
): Promise<FieldDefinition[]> => {
  const sections = (await client.getChildren({ itemId: templateItem.itemId }))
    .filter((child) => conformsTo(child, SITECORE_TEMPLATES.TEMPLATE_SECTION))
    .sort(byTreeOrder);

  const fields: FieldDefinition[] = [];
  for (const section of sections) {
    const fieldItems = (await client.getChildren({ itemId: section.itemId }))
      .filter((child) => conformsTo(child, SITECORE_TEMPLATES.TEMPLATE_FIELD))
      .sort(byTreeOrder);
    for (const fieldItem of fieldItems) {
      fields.push(fieldFromItem(fieldItem, section.name));
    }
  }
  return fields;
};

// ───────────────────────────────────────────────────────────────────────────
// Template-classification base-template checks
// ───────────────────────────────────────────────────────────────────────────

/** True when a template item carries the SXA component base templates. */
export const hasSxaComponentBases = (templateItem: RemoteItem): boolean => {
  const bases = fieldValue(templateItem, SYSTEM_FIELDS.BASE_TEMPLATE, "__Base template");
  if (!bases) return false;
  const baseGuids = bases.split("|").map(normalizeGuid);
  return SXA_COMPONENT_BASE_TEMPLATES.some((sxaBase) => baseGuids.includes(normalizeGuid(sxaBase)));
};

/**
 * True when a template item carries the SXA Headless page base set —
 * the marker that classifies it as a `page-template` rather than a
 * plain content template. Disjoint from `hasSxaComponentBases`:
 * components inherit datasource/component bases, pages inherit the
 * Base Page / navigation / designable / sitemap facets.
 */
export const hasSxaPageBases = (templateItem: RemoteItem): boolean => {
  const bases = fieldValue(templateItem, SYSTEM_FIELDS.BASE_TEMPLATE, "__Base template");
  if (!bases) return false;
  const baseGuids = bases.split("|").map(normalizeGuid);
  // `Base Page` alone is a sufficient signal — the other four facets
  // ride with it in every recipe-emitted page template.
  return SXA_HEADLESS_PAGE_BASE_TEMPLATES.some((pageBase) =>
    baseGuids.includes(normalizeGuid(pageBase))
  );
};

// ───────────────────────────────────────────────────────────────────────────
// Per-template field-shape map (content-bearing kinds)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-field decoder metadata: the abstract shape and the storage axis the
 * template declares. The walker uses `storage` to bucket field values into
 * `shared` vs. per-(language, version) cells before round-tripping.
 */
export interface TemplateFieldInfo {
  shape: FieldShape;
  storage: "shared" | "unversioned" | "versioned";
}
/** `lowercase(fieldName) → TemplateFieldInfo` for one Sitecore template. */
export type TemplateFieldShapes = Map<string, TemplateFieldInfo>;

/**
 * Walk a template item's sections + fields and return a
 * `lowercase(fieldName) → {shape, storage}` map — every field the template
 * declares, plus every field its base templates declare (recursively).
 *
 * The cache short-circuits repeat walks: a content item references its
 * template by GUID, and many items typically share a template, so the
 * per-(`templateGuid`) lookup pays the walk cost once per template.
 *
 * Returns an empty map when the template item can't be loaded — the caller
 * then falls back to inferring per-field shapes from the wire value, which
 * may drop ambiguous fields rather than guess.
 */
export const getTemplateFieldShapes = async (
  templateGuid: string,
  client: AuthoringApiClient,
  cache: Map<string, TemplateFieldShapes>
): Promise<TemplateFieldShapes> => {
  const key = normalizeGuid(templateGuid);
  const cached = cache.get(key);
  if (cached) return cached;

  // Mark as in-flight to short-circuit base-template cycles (Sitecore
  // doesn't allow them in valid trees, but defensive coding).
  const shapes: TemplateFieldShapes = new Map();
  cache.set(key, shapes);

  const templateItem = await client.getItem({ itemId: templateGuid });
  if (!templateItem) return shapes;

  // Recurse into base templates first — local fields override inherited
  // fields when both declare the same name (last-write-wins via Map.set).
  const basesRaw = fieldValue(templateItem, SYSTEM_FIELDS.BASE_TEMPLATE, "__Base template");
  if (basesRaw !== undefined && basesRaw.trim() !== "") {
    for (const baseGuid of basesRaw.split("|")) {
      const norm = normalizeGuid(baseGuid);
      if (!norm || norm === key) continue;
      const baseShapes = await getTemplateFieldShapes(baseGuid, client, cache);
      for (const [name, info] of baseShapes) shapes.set(name, info);
    }
  }

  const sections = (await client.getChildren({ itemId: templateItem.itemId })).filter((c) =>
    conformsTo(c, SITECORE_TEMPLATES.TEMPLATE_SECTION)
  );
  for (const section of sections) {
    const fields = (await client.getChildren({ itemId: section.itemId })).filter((c) =>
      conformsTo(c, SITECORE_TEMPLATES.TEMPLATE_FIELD)
    );
    for (const fieldItem of fields) {
      const typeLabel = fieldValue(fieldItem, TEMPLATE_FIELD_FIELDS.TYPE, "Type");
      const sitecoreType = typeLabel ? sitecoreTypeFromLabel(typeLabel) : undefined;
      const shape: FieldShape = sitecoreType ? shapeFromSitecoreType(sitecoreType) : "text";
      const storage: TemplateFieldInfo["storage"] =
        fieldValue(fieldItem, TEMPLATE_FIELD_FIELDS.SHARED, "Shared") === "1"
          ? "shared"
          : fieldValue(fieldItem, TEMPLATE_FIELD_FIELDS.UNVERSIONED, "Unversioned") === "1"
            ? "unversioned"
            : "versioned";
      shapes.set(fieldItem.name.toLowerCase(), { shape, storage });
    }
  }
  return shapes;
};

// ───────────────────────────────────────────────────────────────────────────
// Authorable-field filtering
// ───────────────────────────────────────────────────────────────────────────

/**
 * Field names the recipe schema doesn't model on content-item fields:
 * system fields (anything starting with `__`), the SCAI Handle marker
 * itself, and the standard-template fields the executor sets implicitly.
 * The compiler omits them from the recipe surface, so the read-back must
 * filter them out too — otherwise round-trip diffs flag them as drift.
 */
const isItemAuthorableField = (name: string | undefined): boolean => {
  if (name === undefined) return false;
  if (name.startsWith("__")) return false;
  if (name === SCAI_HANDLE_FIELD_NAME) return false;
  return true;
};

/** True for any field the recipe surface considers authorable. */
export const authorableFieldsOf = (item: RemoteItem): RemoteItem["fields"] =>
  item.fields.filter((f) => isItemAuthorableField(f.name));

// ───────────────────────────────────────────────────────────────────────────
// GUID→handle marker index
// ───────────────────────────────────────────────────────────────────────────

/**
 * GUID → recipe-handle index for resolving layout-XML references.
 *
 * Layout `<r>` elements reference renderings and datasource items by raw
 * Sitecore GUID; recipes reference the same things by `handle@major`. This
 * index is the bridge: every entry comes from an item's `Scai Handle`
 * marker (see `marker.ts`), keyed by the item's normalised GUID.
 *
 * A GUID with no marker is genuinely unrecoverable — there is no name to
 * synthesise a handle from for a *layout reference* (the layout XML carries
 * only the GUID, not the target item's name), so an unindexed GUID is
 * dropped at resolution time rather than fabricated. This is the
 * lossy-projection contract: omit, never invent.
 */
export type GuidHandleIndex = Map<string, string>;

/**
 * Walk a content-tree subtree collecting every item's `Scai Handle` marker
 * into a GUID→handle map. Recurses through *all* children — the renderings
 * tree nests renderings under section folders, the content tree nests page
 * items and datasource items arbitrarily deep.
 *
 * Returns silently (contributing nothing) when `rootPath` resolves to no
 * item — an absent root is not an error, just an empty contribution.
 */
export const indexMarkersUnder = async (
  rootPath: string | undefined,
  client: AuthoringApiClient,
  index: GuidHandleIndex
): Promise<void> => {
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return;

  const visit = async (item: RemoteItem): Promise<void> => {
    const marker = fieldValueByName(item, SCAI_HANDLE_FIELD_NAME);
    if (marker !== undefined && marker.trim() !== "") {
      index.set(normalizeGuid(item.itemId), marker.trim());
    }
    const children = await client.getChildren({ itemId: item.itemId });
    for (const child of children) {
      await visit(child);
    }
  };
  await visit(root);
};

// ───────────────────────────────────────────────────────────────────────────
// Layout-XML helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve one `ParsedPlacement` (a decoded layout `<r>` element) into a
 * recipe-level `ComponentPlacement`, or `null` when the placement's
 * rendering GUID can't be resolved to a handle.
 *
 * Faithful: `variant`, `params`, and — for a `local:<slot>` sentinel — the
 * `scoped` slot, all of which the layout XML carries directly.
 *
 * LOSSY:
 *  - the rendering GUID MUST resolve via the marker index; an unindexed
 *    GUID drops the whole placement (returning `null`) — there is no
 *    recoverable handle, and a fabricated one would derive the wrong
 *    `renderingId` on the next push.
 *  - a `ds` GUID that resolves becomes a `kind: "shared"` datasourceRef;
 *    one that doesn't is omitted (the placement keeps its variant/params
 *    but loses the datasource binding — better than a dangling handle).
 *    Distinguishing a `shared` content-item GUID from a `scoped` page-local
 *    one is not attempted: `readCurrent` does not reverse-project page-tree
 *    datasource items, and a resolved `ds` handle is treated as `shared`.
 *    A `local:<slot>` sentinel is the one unambiguous `scoped` signal.
 */
export const placementFromParsed = (
  parsed: ParsedPlacement,
  guidIndex: GuidHandleIndex
): ComponentPlacement | null => {
  const componentHandle = guidIndex.get(parsed.renderingGuid);
  if (componentHandle === undefined) {
    // Unrecoverable — the rendering GUID carries no marker. Drop the
    // placement rather than fabricate a handle.
    return null;
  }

  const placement: ComponentPlacement = { componentHandle };
  if (parsed.variant !== undefined) placement.variant = parsed.variant;
  if (parsed.params !== undefined) placement.params = parsed.params;

  if (parsed.datasource !== undefined) {
    if (parsed.datasource.kind === "local") {
      // Pull-side: the materialised `<page>/Data/<slot>` field values are
      // not round-tripped here; leave `fields` empty (Zod's `.default({})`
      // populates if missing, but be explicit for type narrowing).
      placement.datasourceRef = { kind: "scoped", slot: parsed.datasource.slot, fields: {} };
    } else {
      const dsHandle = guidIndex.get(parsed.datasource.guid);
      if (dsHandle !== undefined) {
        placement.datasourceRef = { kind: "shared", handle: dsHandle };
      }
      // An unresolved ds GUID → omit datasourceRef (config-driven by
      // default; the binding is genuinely unrecoverable).
    }
  }
  return placement;
};

/**
 * Reverse-project a layout XML string into a recipe-level `Layout`.
 *
 * Parses the XML (`parseLayoutXml` — handles both canonical + delta wire
 * forms), then resolves every placement's GUIDs to handles through the
 * marker index. Placements whose rendering GUID is unresolvable are
 * dropped; a placeholder left with no placements after the drop is
 * omitted entirely. Per-placeholder placement order is preserved.
 */
export const layoutFromXml = (xml: string, guidIndex: GuidHandleIndex): Layout => {
  const parsed = parseLayoutXml(xml);
  const placeholders: Record<string, ComponentPlacement[]> = {};
  for (const [key, parsedPlacements] of Object.entries(parsed.placeholders)) {
    const placements: ComponentPlacement[] = [];
    for (const parsedPlacement of parsedPlacements) {
      const placement = placementFromParsed(parsedPlacement, guidIndex);
      if (placement) placements.push(placement);
    }
    if (placements.length > 0) placeholders[key] = placements;
  }
  return { placeholders };
};

/** Read an item's layout XML — `__Renderings` (shared) field. */
export const sharedLayoutXmlOf = (item: RemoteItem): string =>
  fieldValue(item, LAYOUT_FIELDS.RENDERINGS, "__Renderings") ?? "";

/** Read an item's final layout XML — `__Final Renderings` (versioned) field. */
export const finalLayoutXmlOf = (item: RemoteItem): string =>
  fieldValue(item, LAYOUT_FIELDS.FINAL_RENDERINGS, "__Final Renderings") ?? "";

/** Read the per-version `__Final Renderings` layout XML and decode to a Layout. */
export const layoutOfSnapshot = (
  snapshot: RemoteItem,
  guidIndex: GuidHandleIndex
): Layout | undefined => {
  const xml = finalLayoutXmlOf(snapshot);
  if (xml === "") return undefined;
  const layout = layoutFromXml(xml, guidIndex);
  return Object.keys(layout.placeholders).length === 0 ? undefined : layout;
};
