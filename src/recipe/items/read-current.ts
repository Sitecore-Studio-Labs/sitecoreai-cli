/**
 * Reverse-projection — live Sitecore items → clean `Recipe` objects.
 *
 * This is the inverse of `src/recipe/compile/*`: where the compilers turn
 * recipes into the Sitecore items a push would create, `readCurrent` walks
 * the items a compiler *would have* produced and reconstructs the recipe.
 * It is the `readCurrent` half of the `recipe` recipe kind (see
 * `recipe-kind.ts` and docs/recipe-sync-architecture.md).
 *
 * ## Scope
 *
 * Ten recipe kinds reverse-project here — those whose item layout is
 * stable and recoverable from the content tree alone:
 *
 *   1.  `component-section`  — a Template Folder directly under componentsRoot
 *   2.  `component-template` — a Template with a matching rendering item
 *   3.  `content-template`   — a Template under contentModelsRoot, no rendering
 *   4.  `page-template`      — a Template carrying the SXA page base set
 *   5.  `enumeration`        — an Enumeration container under enumerationsRoot
 *   6.  `partial-design`     — an SXA Partial Design item under partialDesignsRoot
 *   7.  `page-design`        — an SXA Page Design item under pageDesignsRoot
 *   8.  `page`               — a page item under pagesRoot
 *   9.  `placeholder`        — a Placeholder Settings item under
 *                              placeholderSettingsRoot
 *   10. `content-item`       — a concrete item under contentItemsRoot whose
 *                              template resolves to a known content/component
 *                              template
 *
 * Kinds 6–9 are the layout-bearing (and layout-adjacent) kinds: their
 * fidelity hinges on parsing Sitecore layout XML back into the recipe
 * `Layout` structure — `src/recipe/layout/parse.ts`, the inverse of
 * `layout/emit.ts`. GUIDs inside the layout XML reference renderings and
 * datasources; `readCurrent` builds a GUID→handle index off the
 * `Scai Handle` marker (see `buildGuidHandleIndex`) and resolves them.
 *
 * Kind 10 is the content-bearing kind: per-(language, version) field
 * decoding via a template-field-shape map. Multi-language fan-out uses
 * `getTenantLanguages` + `getItemPerLanguageBatch` so an L-language read
 * is one round trip, not L. Per-(language, version) historic capture
 * follows via `getItemAtVersionsBatch` — same one-round-trip shape.
 *
 * Items under the configured roots that match none of these patterns are
 * silently skipped — not an error. The remaining kinds (site, workflow,
 * webhook-authorization, …) live in trees this walk doesn't visit;
 * `readCurrent` just doesn't produce them.
 *
 * ## Fidelity — this projection is LOSSY by design
 *
 * Recipes carry high-level *intent* the item tree doesn't preserve. The
 * contract is a documented best-effort: reconstruct what the items
 * faithfully yield, and where a recipe field genuinely can't be recovered,
 * **omit it or use the schema default — never fabricate a value**. A
 * `readCurrent` → compile → `plan` round-trip on an unchanged environment
 * should be close to all-`noop`; perfect is the goal, best-effort is the
 * accepted v1 bar. See the per-kind JSDoc below for exactly what is faithful
 * vs. approximated vs. omitted.
 *
 * Layout-XML reverse parsing is itself lossy at the GUID-resolution step:
 * a layout `<r>` element that references a GUID with no `Scai Handle`
 * marker is genuinely unrecoverable — the placement is dropped rather than
 * pointed at a fabricated handle. See `placementFromParsed`.
 *
 * ## v1 limitation
 *
 * `ref.id` is ignored — `readCurrent` pulls every reverse-projectable
 * subtree under the configured roots. Scoping the pull to a single item by
 * name is a future refinement; the orchestrator (`recipe-kind.ts`) passes
 * the whole-set `KindRef` today.
 */

import type { AuthoringApiClient, RemoteItem } from "../api/client";
import {
  COMPOSITION_FIELDS,
  LAYOUT_FIELDS,
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_TEMPLATE_ID,
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  SXA_COMPONENT_BASE_TEMPLATES,
  SXA_HEADLESS_PAGE_BASE_TEMPLATES,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../ir/sitecore-templates";
import { parseLayoutXml, type ParsedPlacement } from "../layout/parse";
import { SCAI_HANDLE_FIELD_NAME } from "./marker";
import type {
  ComponentPlacement,
  ComponentSectionRecipe,
  ComponentTemplateRecipe,
  ContentFieldValue,
  ContentItemRecipe,
  ContentTemplateRecipe,
  ContentTranslation,
  ContentVersion,
  EnumerationRecipe,
  FieldDefinition,
  Layout,
  PageDesignRecipe,
  PageRecipe,
  PageTemplateRecipe,
  PartialDesignRecipe,
  PlaceholderRecipe,
  Recipe,
  SitecoreFieldAugment,
} from "../schema/recipe";
import { HANDLE_PATTERN } from "../schema/recipe";
import type { FieldShape, SitecoreFieldType } from "../schema/field-types";
import { sitecoreFieldTypeLabel } from "../schema/field-types";

/**
 * The compile-time content-tree roots `readCurrent` walks. Mirrors the
 * subset of `CompileContext` that the in-scope kinds actually live under.
 * `recipe-kind.ts` builds this off the resolved env profile — the same
 * fields `plan` reads.
 */
export interface ReadCurrentRoots {
  /** Legacy flat templates root. Content/component templates fall back here. */
  templatesRoot: string;
  /** Renderings root — used to detect which templates have a rendering. */
  renderingsRoot: string;
  /** Per-site Components bucket. Component templates + sections live here. */
  componentsRoot?: string;
  /** Per-site Content Models bucket. Content templates live here. */
  contentModelsRoot?: string;
  /** Page-templates root. Templates carrying the SXA page base set live here. */
  pageTemplatesRoot?: string;
  /** Enumerations root. Enumeration containers + value items live here. */
  enumerationsRoot?: string;
  /** Partial Designs root. SXA Partial Design items live here. */
  partialDesignsRoot?: string;
  /** Page Designs root. SXA Page Design items live directly under it. */
  pageDesignsRoot?: string;
  /** Pages root. Concrete page items live here (often the site Home node). */
  pagesRoot?: string;
  /** Placeholder Settings root. Placeholder Settings items live under it. */
  placeholderSettingsRoot?: string;
  /**
   * Content Items root. Concrete content-item items (the targets of `kind:
   * "shared"` datasource placements — site-logo, primary-nav, etc.) live
   * directly under it.
   */
  contentItemsRoot?: string;
}

/**
 * Normalise a Sitecore GUID for comparison: lowercase, strip curly braces
 * and hyphens. The Authoring API returns GUIDs hyphen-less
 * (`1930bbeb7805471a…`) while the built-in template constants are
 * hyphenated — normalising both sides to the bare 32-hex form is what makes
 * `conformsTo` / `guidEquals` actually match against a live tenant.
 */
const normalizeGuid = (guid: string): string => guid.trim().toLowerCase().replace(/[{}-]/g, "");

/** True when two Sitecore GUIDs refer to the same item (curly/case-insensitive). */
const guidEquals = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && normalizeGuid(a) === normalizeGuid(b);

/**
 * Look up a field value on a `RemoteItem` by field GUID OR field name. The
 * compiler emits some fields by GUID and some by name; reverse-projection
 * matches on either so it stays robust against the GUID/name split the
 * executor's resolver papers over (see `RemoteFieldValue.name`).
 */
const fieldValue = (item: RemoteItem, fieldId: string, fieldName?: string): string | undefined => {
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
const fieldValueByName = (item: RemoteItem, fieldName: string): string | undefined => {
  const match = item.fields.find(
    (f) => f.name !== undefined && f.name.toLowerCase() === fieldName.toLowerCase()
  );
  return match?.value;
};

/** True when the item conforms to the given Sitecore built-in template. */
const conformsTo = (item: RemoteItem, templateId: string): boolean =>
  guidEquals(item.templateId, templateId);

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
 * Prefers the `Scai Handle` marker field, which carries the *exact* handle
 * `push` stamped on every recipe-managed item: a marked item round-trips to
 * the author's real handle regardless of how the item was later moved or
 * renamed. Falls back to synthesising one from the item name
 * (`handleFromName`) only for unmarked items — a first capture of an
 * environment scai never pushed to, or items created outside scai.
 *
 * See `marker.ts` and docs/recipe-sync-architecture.md, "Recipe identity".
 */
/**
 * Recovery rule:
 *   1. Tenant-stamped `Scai Handle` marker (preferred, but TRUSTED ONLY
 *      IF SHAPE-VALID — see security note below).
 *   2. Synthesise from the item name (fallback for unmarked items).
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
 */
const handleOf = (item: RemoteItem): string => {
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
const byTreeOrder = (a: RemoteItem, b: RemoteItem): number => {
  const so = sortOrderOf(a) - sortOrderOf(b);
  return so !== 0 ? so : a.name.localeCompare(b.name);
};

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
const sitecoreTypeFromLabel = (label: string): SitecoreFieldType | undefined => {
  const target = label.trim().toLowerCase();
  return SITECORE_TYPES.find((t) => sitecoreFieldTypeLabel(t).toLowerCase() === target);
};

/**
 * Map a stored Sitecore field type back to the recipe's abstract
 * `FieldShape`. This inverts `defaultSitecoreFieldType`.
 *
 * LOSSY: the forward map is many-to-one in places, so the inverse picks the
 * canonical shape. Notably `droplink` could originate from either
 * `shape: "enum"` or `shape: "reference"` (single) — `fieldFromItem`
 * disambiguates using the presence of a `Source` (enum → `Source` is an
 * enumerations path; bare reference → typically no enum-shaped source). The
 * raw type is always preserved verbatim on `sitecore.type` so the field
 * still compiles to the exact same Sitecore type regardless.
 */
const shapeFromSitecoreType = (type: SitecoreFieldType): FieldShape => {
  switch (type) {
    case "single-line-text":
      return "text";
    case "multi-line-text":
      return "text";
    case "rich-text":
      return "richText";
    case "image":
      return "image";
    case "file":
      return "image";
    case "general-link":
      return "link";
    case "checkbox":
      return "boolean";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "droplist":
      return "enum";
    case "droplink":
      return "reference";
    case "treelist":
      return "reference";
    case "treelist-with-search":
      return "reference";
    case "lookup":
      return "reference";
    case "tags":
      return "reference";
    case "Plugin":
      // Marketplace plugin field. The stored value is a string (digest
      // or JSON blob the plugin postMessages back via setValue), so
      // round-trip as text. The plugin identity itself lives in the
      // field's Source — recovered separately by source-detection logic.
      return "text";
    default: {
      // Exhaustiveness check — if SitecoreFieldType grows a new
      // member, TS will flag this assignment until a case is added
      // above. Fallback to "text" at runtime so unknown values don't
      // crash the read path.
      const _exhaustive: never = type;
      return "text" as FieldShape;
    }
  }
};

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
const fieldFromItem = (fieldItem: RemoteItem, sectionName: string): FieldDefinition => {
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
const fieldsOfTemplate = async (
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

/**
 * Reverse-project one component-template `TEMPLATE` item (paired with its
 * rendering) into a `ComponentTemplateRecipe`.
 *
 * Faithful: `name`, `displayName` (`__Display name`, falling back to
 * `name`), `description`, and the full `fields[]` tree (sections + fields).
 *
 * LOSSY / omitted:
 *  - `handle` is the `Scai Handle` marker, or synthesised from `name` for an
 *    unmarked item (see `handleOf`).
 *  - `section` reference — the component lives *under* a section folder, and
 *    the section is its own recipe with its own handle; the caller resolves
 *    that section's handle (marker-aware) and threads it in here. When the
 *    component sits flat under a root, `section` is omitted.
 *  - `variants`, `params`, `datasource`, `insertOptions`,
 *    `placedIn`, `placeholders`, `children`, `parameters`, `dynamicPlaceholders`,
 *    `otherProperties` — these live in separate trees (Headless Variants,
 *    Presentation Parameters, Available Renderings, Placeholder Settings) or
 *    in the rendering's URL-encoded blobs. v1 reverse-projection captures
 *    the template + datasource fields only; the schema defaults ([]/false)
 *    cover the rest. The rendering item is detected (to classify the
 *    template as a component) but its `OtherProperties` / `Datasource
 *    Location` are not decoded.
 */
const componentTemplateFromItem = async (
  templateItem: RemoteItem,
  sectionHandle: string | undefined,
  client: AuthoringApiClient
): Promise<ComponentTemplateRecipe> => {
  const displayName =
    fieldValue(templateItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? templateItem.name;
  const description = fieldValueByName(templateItem, "__Long description");
  const fields = await fieldsOfTemplate(templateItem, client);

  const recipe: ComponentTemplateRecipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: handleOf(templateItem),
    name: templateItem.name,
    displayName,
    fields,
    // Schema defaults — not reverse-projected in v1 (see JSDoc).
    variants: [],
    params: [],
    placedIn: [],
    placeholders: [],
    dynamicPlaceholders: false,
  };
  if (description !== undefined && description !== "") recipe.description = description;
  if (sectionHandle) {
    recipe.section = { handle: sectionHandle };
  }
  return recipe;
};

/**
 * Reverse-project one content-template `TEMPLATE` item into a
 * `ContentTemplateRecipe`.
 *
 * Faithful: `name`, `displayName`, `description`, and the `fields[]` tree.
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker, or synthesised from
 * `name` for an unmarked item (see `handleOf`); `meta.tax.group` is
 * reconstructed from the Content Models group folder the template sits under
 * (threaded in by the caller); `insertOptions` and `defaultWorkflow` are not
 * reverse-projected (they live on the `__Standard Values` item's
 * `__Masters` / `__Default workflow` fields as GUID lists that would need
 * resolving back to handles).
 */
const contentTemplateFromItem = async (
  templateItem: RemoteItem,
  group: string | undefined,
  client: AuthoringApiClient
): Promise<ContentTemplateRecipe> => {
  const displayName =
    fieldValue(templateItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? templateItem.name;
  const description = fieldValueByName(templateItem, "__Long description");
  const fields = await fieldsOfTemplate(templateItem, client);

  const recipe: ContentTemplateRecipe = {
    kind: "content-template",
    schemaVersion: "1",
    handle: handleOf(templateItem),
    name: templateItem.name,
    displayName,
    fields,
  };
  if (description !== undefined && description !== "") recipe.description = description;
  if (group) recipe.meta = { tax: { group } };
  return recipe;
};

/**
 * Reverse-project one page-template `TEMPLATE` item into a
 * `PageTemplateRecipe`.
 *
 * Faithful: `name`, `displayName`, `description`, and the `fields[]`
 * tree (the page-specific fields on top of the inherited SXA base).
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker or synthesised
 * from `name`; `insertOptions`, `layout` (the standard-values
 * `__Renderings` shell), and `defaultWorkflow` are not reverse-projected
 * — the same omissions as `contentTemplateFromItem`, plus layout-XML
 * reverse parsing which v1 doesn't do.
 */
const pageTemplateFromItem = async (
  templateItem: RemoteItem,
  client: AuthoringApiClient
): Promise<PageTemplateRecipe> => {
  const displayName =
    fieldValue(templateItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? templateItem.name;
  const description = fieldValueByName(templateItem, "__Long description");
  const fields = await fieldsOfTemplate(templateItem, client);

  const recipe: PageTemplateRecipe = {
    kind: "page-template",
    schemaVersion: "1",
    handle: handleOf(templateItem),
    name: templateItem.name,
    displayName,
    fields,
  };
  if (description !== undefined && description !== "") recipe.description = description;
  return recipe;
};

/**
 * Reverse-project one component-section Template Folder into a
 * `ComponentSectionRecipe`.
 *
 * Faithful: `name`, `displayName` (`__Display name`, default `name`),
 * `description`, `icon` (`__Icon`), and `sortOrder` (`__Sortorder`).
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker, or synthesised from
 * `name` for an unmarked folder (see `handleOf`). The section's identity is
 * otherwise purely the folder — nothing else to recover.
 */
const componentSectionFromItem = (folderItem: RemoteItem): ComponentSectionRecipe => {
  const displayName = fieldValue(folderItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name");
  const description = fieldValueByName(folderItem, "__Long description");
  const icon = fieldValue(folderItem, SYSTEM_FIELDS.ICON, "__Icon");
  const sortOrderRaw = fieldValue(folderItem, SYSTEM_FIELDS.SORT_ORDER, "__Sortorder");

  const recipe: ComponentSectionRecipe = {
    kind: "component-section",
    schemaVersion: "1",
    handle: handleOf(folderItem),
    name: folderItem.name,
  };
  if (displayName !== undefined && displayName !== "" && displayName !== folderItem.name) {
    recipe.displayName = displayName;
  }
  if (description !== undefined && description !== "") recipe.description = description;
  if (icon !== undefined && icon !== "") recipe.icon = icon;
  if (sortOrderRaw !== undefined) {
    const n = Number.parseInt(sortOrderRaw, 10);
    if (Number.isFinite(n)) recipe.sortOrder = n;
  }
  return recipe;
};

/**
 * Reverse-project one `Enumeration`-container item into an
 * `EnumerationRecipe`.
 *
 * Faithful: `name`, `displayName`, `description`, the ordered `values[]`
 * (each value item's `name` + `displayName`), and `default` — read from the
 * container's `Value` shared field, kept only when it matches one of the
 * declared values (the compiler validates `default ∈ values`).
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker, or synthesised from
 * `name` for an unmarked container (see `handleOf`); `location.folder` is
 * reconstructed by the caller from the grouping folders the container sits
 * under. An enumeration with no value items can't reverse-project (the
 * schema requires `values.min(1)`) — such a container is skipped by the
 * orchestrator with no error.
 */
const enumerationFromItem = async (
  containerItem: RemoteItem,
  folderSegments: string[],
  client: AuthoringApiClient
): Promise<EnumerationRecipe | null> => {
  const valueItems = (await client.getChildren({ itemId: containerItem.itemId }))
    .filter((child) => child.name !== "__Standard Values")
    .sort(byTreeOrder);
  if (valueItems.length === 0) {
    // The schema requires values.min(1) — a value-less container is not a
    // reverse-projectable enumeration. Skip rather than emit invalid data.
    return null;
  }

  const values = valueItems.map((valueItem) => {
    const valueDisplayName = fieldValue(valueItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name");
    const value: EnumerationRecipe["values"][number] = { name: valueItem.name };
    if (
      valueDisplayName !== undefined &&
      valueDisplayName !== "" &&
      valueDisplayName !== valueItem.name
    ) {
      value.displayName = valueDisplayName;
    }
    return value;
  });

  const displayName = fieldValue(containerItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name");
  const description = fieldValueByName(containerItem, "__Long description");
  const defaultValue = fieldValueByName(containerItem, "Value");

  const recipe: EnumerationRecipe = {
    kind: "enumeration",
    schemaVersion: "1",
    handle: handleOf(containerItem),
    name: containerItem.name,
    values,
  };
  if (displayName !== undefined && displayName !== "" && displayName !== containerItem.name) {
    recipe.displayName = displayName;
  }
  if (description !== undefined && description !== "") recipe.description = description;
  if (folderSegments.length > 0) {
    recipe.location = { scope: "site", folder: folderSegments };
  }
  // Only carry `default` when it names a real value — the compiler rejects
  // an out-of-range default, and a stale container `Value` is not intent.
  if (
    defaultValue !== undefined &&
    defaultValue !== "" &&
    values.some((v) => v.name === defaultValue)
  ) {
    recipe.default = defaultValue;
  }
  return recipe;
};

/** True when a template item carries the SXA component base templates. */
const hasSxaComponentBases = (templateItem: RemoteItem): boolean => {
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
const hasSxaPageBases = (templateItem: RemoteItem): boolean => {
  const bases = fieldValue(templateItem, SYSTEM_FIELDS.BASE_TEMPLATE, "__Base template");
  if (!bases) return false;
  const baseGuids = bases.split("|").map(normalizeGuid);
  // `Base Page` alone is a sufficient signal — the other four facets
  // ride with it in every recipe-emitted page template.
  return SXA_HEADLESS_PAGE_BASE_TEMPLATES.some((pageBase) =>
    baseGuids.includes(normalizeGuid(pageBase))
  );
};

/**
 * Index every rendering item under `renderingsRoot` by component name, so a
 * candidate template can be classified as a component (has a rendering) vs.
 * a content template (no rendering). Returns a Set of component names — the
 * rendering's `Component Name` field, falling back to the item name.
 *
 * Returns an empty set when `renderingsRoot` resolves to no item.
 */
const collectRenderingComponentNames = async (
  renderingsRoot: string,
  client: AuthoringApiClient
): Promise<Set<string>> => {
  const names = new Set<string>();
  const root = renderingsRoot ? await client.getItem({ path: renderingsRoot }) : null;
  if (!root) return names;

  const walk = async (parent: RemoteItem): Promise<void> => {
    const children = await client.getChildren({ itemId: parent.itemId });
    for (const child of children) {
      if (conformsTo(child, SITECORE_TEMPLATES.RENDERING)) {
        const componentName =
          fieldValue(child, RENDERING_FIELDS.COMPONENT_NAME, "ComponentName") ?? child.name;
        names.add(componentName);
        names.add(child.name);
      } else if (
        conformsTo(child, SITECORE_TEMPLATES.RENDERING_FOLDER) ||
        conformsTo(child, SITECORE_TEMPLATES.FOLDER)
      ) {
        await walk(child);
      }
    }
  };
  await walk(root);
  return names;
};

/**
 * Walk every `TEMPLATE` item under a templates-tree root, reverse-projecting
 * each into either a component-template or content-template recipe.
 *
 * Templates are discovered by recursing through `TEMPLATE_FOLDER` items. A
 * `TEMPLATE_FOLDER` sitting *directly* under `componentsRoot` is itself a
 * component section and is emitted as a `ComponentSectionRecipe`; its
 * children are then component templates carrying that `section`.
 *
 * Classification of a `TEMPLATE` item:
 *  - has SXA component bases OR a matching rendering → component-template
 *  - otherwise → content-template
 */
const walkTemplatesTree = async (
  rootPath: string,
  client: AuthoringApiClient,
  renderingComponentNames: Set<string>,
  isComponentsRoot: boolean,
  isContentModelsRoot: boolean
): Promise<Recipe[]> => {
  const recipes: Recipe[] = [];
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return recipes;

  /**
   * Recurse. `sectionHandle` is the handle of the component section the
   * current subtree is under (set when we descended through a section folder
   * under componentsRoot — marker-aware, so component templates reference the
   * section by its real handle); `group` is the Content Models group folder
   * name.
   */
  const walk = async (
    parent: RemoteItem,
    sectionHandle: string | undefined,
    group: string | undefined,
    depth: number
  ): Promise<void> => {
    const children = (await client.getChildren({ itemId: parent.itemId })).sort(byTreeOrder);
    for (const child of children) {
      if (conformsTo(child, SITECORE_TEMPLATES.TEMPLATE)) {
        // Classify the template item. Page bases are checked first —
        // they're disjoint from component bases, and a page template
        // is neither a component nor a plain content shape.
        if (hasSxaPageBases(child)) {
          recipes.push(await pageTemplateFromItem(child, client));
        } else if (hasSxaComponentBases(child) || renderingComponentNames.has(child.name)) {
          recipes.push(await componentTemplateFromItem(child, sectionHandle, client));
        } else {
          recipes.push(await contentTemplateFromItem(child, group, client));
        }
        continue;
      }
      if (
        conformsTo(child, SITECORE_TEMPLATES.TEMPLATE_FOLDER) ||
        conformsTo(child, SITECORE_TEMPLATES.FOLDER)
      ) {
        // A folder directly under componentsRoot IS a component section.
        // Emit the section recipe, then descend carrying its handle so the
        // component templates beneath it reference the same identity.
        if (isComponentsRoot && depth === 0) {
          const section = componentSectionFromItem(child);
          recipes.push(section);
          await walk(child, section.handle, group, depth + 1);
          continue;
        }
        // A folder directly under contentModelsRoot is a taxonomy group.
        const nextGroup = isContentModelsRoot && depth === 0 ? child.name : group;
        // Skip the subordinate buckets (Component Folders / Presentation
        // Parameters) — they hold support templates, not authorable kinds.
        if (child.name === "Component Folders" || child.name === "Presentation Parameters") {
          continue;
        }
        await walk(child, sectionHandle, nextGroup, depth + 1);
        continue;
      }
      // Anything else (Standard Values, renderings, etc.) — not a
      // reverse-projectable kind. Skip silently.
    }
  };

  await walk(root, undefined, undefined, 0);
  return recipes;
};

/**
 * Walk the enumerations tree, reverse-projecting each `Enumeration`-template
 * container into an `EnumerationRecipe`. Grouping folders (`Enumerations
 * Folder` template) are recursed into; the cumulative folder path is
 * threaded onto each enum's `location.folder`.
 */
const walkEnumerationsTree = async (
  rootPath: string,
  client: AuthoringApiClient
): Promise<Recipe[]> => {
  const recipes: Recipe[] = [];
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return recipes;

  /**
   * An item is an enumeration *container* (vs. a grouping folder) when its
   * children are leaf value items rather than further containers/folders.
   * The cheapest reliable signal available without GUID knowledge of the
   * per-site `Enumeration` template: a container's children carry no
   * sub-children that are themselves enumerations. We instead use the
   * structural rule the compiler guarantees — grouping folders only ever
   * parent containers/other folders, containers only ever parent value
   * leaves — and treat any item whose children are all childless leaves as
   * a container. `Enumerations Folder` items are recursed; everything else
   * with ≥1 child is treated as a container.
   */
  // `folderSegments` carries the grouping-folder path as `string[]` —
  // matches the canonical array shape on `EnumerationRecipe.location.folder`
  // so the reverse-projected recipe emits the same wire shape authors hand
  // to scai (no slash-joined fallback).
  const walk = async (parent: RemoteItem, folderSegments: string[]): Promise<void> => {
    const children = (await client.getChildren({ itemId: parent.itemId }))
      .filter((c) => c.name !== "__Standard Values")
      .sort(byTreeOrder);
    for (const child of children) {
      const grandchildren = (await client.getChildren({ itemId: child.itemId })).filter(
        (gc) => gc.name !== "__Standard Values"
      );
      if (grandchildren.length === 0) {
        // A childless item under the enumerations root is neither a
        // grouping folder nor a populated container — skip.
        continue;
      }
      // Determine whether `child` is a grouping folder or a container by
      // inspecting its grandchildren: if any grandchild itself has
      // children, `child` groups containers → it's a folder. Otherwise its
      // children are value leaves → `child` is a container.
      let groupsContainers = false;
      for (const gc of grandchildren) {
        const ggc = await client.getChildren({ itemId: gc.itemId });
        if (ggc.filter((x) => x.name !== "__Standard Values").length > 0) {
          groupsContainers = true;
          break;
        }
      }
      if (groupsContainers) {
        await walk(child, [...folderSegments, child.name]);
      } else {
        const recipe = await enumerationFromItem(child, folderSegments, client);
        if (recipe) recipes.push(recipe);
      }
    }
  };

  await walk(root, []);
  return recipes;
};

// ───────────────────────────────────────────────────────────────────────────
// Layout-bearing kinds — partial-design, page-design, page, placeholder
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
type GuidHandleIndex = Map<string, string>;

/**
 * Walk a content-tree subtree collecting every item's `Scai Handle` marker
 * into a GUID→handle map. Recurses through *all* children — the renderings
 * tree nests renderings under section folders, the content tree nests page
 * items and datasource items arbitrarily deep.
 *
 * Returns silently (contributing nothing) when `rootPath` resolves to no
 * item — an absent root is not an error, just an empty contribution.
 */
const indexMarkersUnder = async (
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

/**
 * Build the GUID→handle index `readCurrent` resolves cross-item GUID
 * references against. Indexes:
 *
 *  - the renderings tree — so layout `<r id>` GUIDs and placeholder
 *    `Allowed Controls` GUIDs resolve to `componentHandle`s;
 *  - the templates trees (`componentsRoot` / `contentModelsRoot` /
 *    `pageTemplatesRoot` / the `templatesRoot` fallback) — so a page
 *    item's `templateId` and the Page Designs root's `TemplatesMapping`
 *    template GUIDs resolve to page-template handles;
 *  - the Partial Designs tree — so a page design's `PartialDesigns`
 *    GUID list resolves to partial-design handles;
 *  - the pages tree — so layout `<r ds>` GUIDs that point at page-local
 *    datasource items resolve.
 *
 * `read-current.ts` does not reverse-project content-item *items*
 * themselves — but it still needs their markers to resolve the GUIDs
 * layout XML points at, so the pages tree (which holds `<page>/Data/<slot>`
 * datasource items) is indexed too.
 *
 * Walking the same root twice is harmless — `indexMarkersUnder` is a pure
 * `Map.set`, and a duplicate path simply re-sets identical entries.
 */
const buildGuidHandleIndex = async (
  roots: ReadCurrentRoots,
  client: AuthoringApiClient
): Promise<GuidHandleIndex> => {
  const index: GuidHandleIndex = new Map();
  await indexMarkersUnder(roots.renderingsRoot, client, index);
  await indexMarkersUnder(roots.componentsRoot, client, index);
  await indexMarkersUnder(roots.contentModelsRoot, client, index);
  await indexMarkersUnder(roots.pageTemplatesRoot, client, index);
  // Flat templatesRoot fallback — only when no bucket root covers it (the
  // same dedup rule the templates walk uses).
  if (!roots.componentsRoot && !roots.contentModelsRoot) {
    await indexMarkersUnder(roots.templatesRoot, client, index);
  }
  await indexMarkersUnder(roots.partialDesignsRoot, client, index);
  await indexMarkersUnder(roots.pagesRoot, client, index);
  // Content items reference each other (single-element `refs[]` on a
  // Droplink, Treelist Source pickers, link-internal targets) by GUID;
  // index the content-items tree so the cross-CI references resolve.
  await indexMarkersUnder(roots.contentItemsRoot, client, index);
  return index;
};

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
const placementFromParsed = (
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
      placement.datasourceRef = { kind: "scoped", slot: parsed.datasource.slot };
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
const layoutFromXml = (xml: string, guidIndex: GuidHandleIndex): Layout => {
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
const sharedLayoutXmlOf = (item: RemoteItem): string =>
  fieldValue(item, LAYOUT_FIELDS.RENDERINGS, "__Renderings") ?? "";

/** Read an item's final layout XML — `__Final Renderings` (versioned) field. */
const finalLayoutXmlOf = (item: RemoteItem): string =>
  fieldValue(item, LAYOUT_FIELDS.FINAL_RENDERINGS, "__Final Renderings") ?? "";

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
): PartialDesignRecipe => {
  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");
  const icon = fieldValue(item, SYSTEM_FIELDS.ICON, "__Icon");

  const recipe: PartialDesignRecipe = {
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
 * Decode the Page Designs root's `TemplatesMapping` field into a list of
 * `{ templateGuid, designGuid }` pairs. Inverse of
 * `encodeTemplatesMapping` (`layout/templates-mapping.ts`): the field
 * stores `{tplGuid}={designGuid}&…` URL-encoded.
 */
const decodeTemplatesMapping = (
  raw: string
): Array<{ templateGuid: string; designGuid: string }> => {
  const entries: Array<{ templateGuid: string; designGuid: string }> = [];
  for (const pair of raw.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const templateGuid = normalizeGuid(decodeURIComponent(pair.slice(0, eq)));
    const designGuid = normalizeGuid(decodeURIComponent(pair.slice(eq + 1)));
    if (templateGuid && designGuid) entries.push({ templateGuid, designGuid });
  }
  return entries;
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
): PageDesignRecipe => {
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

  const recipe: PageDesignRecipe = {
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
const pageFromItem = async (
  item: RemoteItem,
  templateHandle: string,
  client: AuthoringApiClient,
  guidIndex: GuidHandleIndex,
  templateShapeCache: Map<string, TemplateFieldShapes>,
  tenantLanguages: readonly string[]
): Promise<PageRecipe | null> => {
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
  const historicRequests: Array<{ language: string; version: number }> = [];
  for (const row of populated) {
    for (const v of row.versions) {
      if (v < row.versions[row.versions.length - 1]) {
        historicRequests.push({ language: row.language, version: v });
      }
    }
  }
  const historic =
    historicRequests.length > 0
      ? await client.getItemAtVersionsBatch({ itemId: item.itemId }, historicRequests)
      : [];
  const historicByLangVer = new Map<string, RemoteItem>();
  for (let i = 0; i < historicRequests.length; i += 1) {
    const snap = historic[i];
    if (snap)
      historicByLangVer.set(`${historicRequests[i].language}|${historicRequests[i].version}`, snap);
  }

  const decodeVersionedFields = (snapshot: RemoteItem): Record<string, ContentFieldValue> => {
    const out: Record<string, ContentFieldValue> = {};
    for (const f of authorableFieldsOf(snapshot)) {
      if (f.language === undefined && f.version === undefined) continue;
      if (f.name === undefined) continue;
      const info = shapes.get(f.name.toLowerCase());
      if (info === undefined) continue;
      if (info.storage === "shared") continue;
      const decoded = decodeContentFieldValue(f.value, info.shape, guidIndex);
      if (decoded !== null) out[f.name] = decoded;
    }
    return out;
  };

  const sharedFields: Record<string, ContentFieldValue> = {};
  for (const row of populated) {
    if (!row.item) continue;
    for (const f of authorableFieldsOf(row.item)) {
      if (f.language !== undefined || f.version !== undefined) continue;
      if (f.name === undefined || f.name in sharedFields) continue;
      const info = shapes.get(f.name.toLowerCase());
      if (info === undefined || info.storage !== "shared") continue;
      const decoded = decodeContentFieldValue(f.value, info.shape, guidIndex);
      if (decoded !== null) sharedFields[f.name] = decoded;
    }
  }

  const layoutOfSnapshot = (snapshot: RemoteItem): Layout | undefined => {
    const xml = finalLayoutXmlOf(snapshot);
    if (xml === "") return undefined;
    const layout = layoutFromXml(xml, guidIndex);
    return Object.keys(layout.placeholders).length === 0 ? undefined : layout;
  };

  const dateOfSnapshot = (snapshot: RemoteItem): string | undefined => {
    const raw = fieldValueByName(snapshot, "__Created");
    if (raw === undefined || raw === "") return undefined;
    return decodeSitecoreDateToIso(raw, "datetime");
  };

  // Mode decision: story when any populated language has > 1 version.
  // Unlike content items, pages' simple mode CAN carry an item-level
  // layout (the schema supports it), so a single-version multi-language
  // page with a layout still round-trips as simple mode.
  const isStory = populated.some((row) => row.versions.length > 1);

  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");

  const base: PageRecipe = {
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

  if (!isStory) {
    // Simple mode — default-language fields + translations for other langs.
    const DEFAULT_LANG = "en";
    const primaryRow = populated.find((row) => row.language === DEFAULT_LANG) ?? populated[0];
    const primaryLang = primaryRow.language;
    if (primaryRow.item) {
      base.fields = decodeVersionedFields(primaryRow.item);
      const primaryLayout = layoutOfSnapshot(primaryRow.item);
      if (primaryLayout !== undefined) base.layout = primaryLayout;
    }
    const translations: Record<string, ContentTranslation> = {};
    for (const row of populated) {
      if (row.language === primaryLang) continue;
      if (!row.item) continue;
      const fields = decodeVersionedFields(row.item);
      if (Object.keys(fields).length > 0) translations[row.language] = { fields };
    }
    if (Object.keys(translations).length > 0) base.translations = translations;
    return base;
  }

  // Story mode — every (lang, version) cell becomes a ContentVersion entry.
  // `fields` stays empty per the simple-vs-story XOR; per-version layouts
  // are the only place layout lives.
  const versions: Record<string, ContentVersion[]> = {};
  for (const row of populated) {
    const entries: ContentVersion[] = [];
    for (const v of row.versions) {
      const isLatest = v === row.versions[row.versions.length - 1];
      const snapshot = isLatest ? row.item : historicByLangVer.get(`${row.language}|${v}`);
      if (!snapshot) continue;
      const entry: ContentVersion = { version: v, fields: decodeVersionedFields(snapshot) };
      const date = dateOfSnapshot(snapshot);
      if (date !== undefined) entry.date = date;
      const layout = layoutOfSnapshot(snapshot);
      if (layout !== undefined) entry.layout = layout;
      entries.push(entry);
    }
    if (entries.length > 0) versions[row.language] = entries;
  }
  if (Object.keys(versions).length > 0) base.versions = versions;
  return base;
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
): PageRecipe => {
  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");
  const recipe: PageRecipe = {
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
): PlaceholderRecipe | null => {
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

  const recipe: PlaceholderRecipe = {
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
const walkPartialDesignsTree = async (
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
const walkPageDesignsTree = async (
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
const walkPagesTree = async (
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
      const recipe = await pageFromItem(
        child,
        templateHandle,
        client,
        guidIndex,
        templateShapeCache,
        tenantLanguages
      );
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
const walkPlaceholderSettingsTree = async (
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

// ───────────────────────────────────────────────────────────────────────────
// Content items — kind 10, content-bearing rather than layout-bearing
// ───────────────────────────────────────────────────────────────────────────

/**
 * Decode a Sitecore wire-format datetime (`yyyyMMddTHHmmssZ`) back to an
 * ISO 8601 string. Inverse of `toSitecoreDate` in `compile/content-item.ts`:
 * `kind: "date"` returns `YYYY-MM-DD`, `"datetime"` returns
 * `YYYY-MM-DDTHH:mm:ssZ`. Returns `undefined` when the wire string doesn't
 * match the expected shape — the caller drops the field rather than fabricate.
 */
const decodeSitecoreDateToIso = (wire: string, kind: "date" | "datetime"): string | undefined => {
  const m = wire.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return undefined;
  const [, yyyy, MM, dd, HH, mm, ss] = m;
  if (kind === "date") return `${yyyy}-${MM}-${dd}`;
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}Z`;
};

/** Inverse of the `escapeXmlAttr` the compiler uses on XML attribute values. */
const unescapeXmlAttr = (s: string): string =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

const matchAttr = (xml: string, name: string): string | undefined => {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = re.exec(xml);
  return m ? unescapeXmlAttr(m[1]) : undefined;
};

/**
 * Decode an `<image mediapath="…" alt="…" width="…" height="…" />` blob
 * into the image-shape `ContentFieldValue` payload. Returns `undefined`
 * when the blob is not a recognisable image element (caller drops the
 * field) — `mediapath` is the load-bearing attribute.
 */
const decodeImageXml = (
  xml: string
): { mediaPath: string; alt?: string; width?: number; height?: number } | undefined => {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<image")) return undefined;
  const mediaPath = matchAttr(trimmed, "mediapath");
  if (mediaPath === undefined || mediaPath === "") return undefined;
  const out: { mediaPath: string; alt?: string; width?: number; height?: number } = { mediaPath };
  const alt = matchAttr(trimmed, "alt");
  if (alt !== undefined) out.alt = alt;
  const widthRaw = matchAttr(trimmed, "width");
  if (widthRaw !== undefined) {
    const n = Number.parseInt(widthRaw, 10);
    if (Number.isFinite(n) && n > 0) out.width = n;
  }
  const heightRaw = matchAttr(trimmed, "height");
  if (heightRaw !== undefined) {
    const n = Number.parseInt(heightRaw, 10);
    if (Number.isFinite(n) && n > 0) out.height = n;
  }
  return out;
};

/**
 * Decode an external General-Link XML blob into the link-external-shape
 * payload. Returns `undefined` when the blob is not a `linktype="external"`
 * `<link>` element (caller branches to link-internal or drops the field).
 */
const decodeExternalLinkXml = (
  xml: string
): { href: string; text?: string; target?: string; title?: string } | undefined => {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<link")) return undefined;
  const linktype = matchAttr(trimmed, "linktype");
  if (linktype !== "external") return undefined;
  const url = matchAttr(trimmed, "url");
  if (url === undefined || url === "") return undefined;
  const out: { href: string; text?: string; target?: string; title?: string } = { href: url };
  const text = matchAttr(trimmed, "text");
  if (text !== undefined) out.text = text;
  const target = matchAttr(trimmed, "target");
  if (target !== undefined) out.target = target;
  const title = matchAttr(trimmed, "title");
  if (title !== undefined) out.title = title;
  return out;
};

/**
 * Decode an internal General-Link XML blob — `linktype="internal"` with an
 * `id="{guid}"` pointing at the target item. Returns `undefined` when the
 * blob is not an internal link or the target GUID has no marker (handle
 * unrecoverable — caller drops the field rather than fabricate).
 */
const decodeInternalLinkXml = (
  xml: string,
  guidIndex: GuidHandleIndex
): { ref: string; text?: string; target?: string } | undefined => {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<link")) return undefined;
  const linktype = matchAttr(trimmed, "linktype");
  if (linktype !== "internal") return undefined;
  const idRaw = matchAttr(trimmed, "id");
  if (idRaw === undefined || idRaw === "") return undefined;
  const ref = guidIndex.get(normalizeGuid(idRaw));
  if (ref === undefined) return undefined;
  const out: { ref: string; text?: string; target?: string } = { ref };
  const text = matchAttr(trimmed, "text");
  if (text !== undefined) out.text = text;
  const target = matchAttr(trimmed, "target");
  if (target !== undefined) out.target = target;
  return out;
};

/**
 * Decode one raw Sitecore field value back to a typed `ContentFieldValue`
 * dispatched by the field's declared abstract `FieldShape`. Returns `null`
 * when the value isn't decodable under that shape (empty / malformed /
 * handle unrecoverable) — the caller drops the field rather than emit a
 * shape-violating value.
 *
 * The `FieldShape` taxonomy has `"link"` (the abstract data shape). The
 * recipe `ContentFieldValue` discriminates `"link-external"` vs
 * `"link-internal"` at the value level — this decoder picks the right
 * branch by inspecting the XML's `linktype`. An internal link whose GUID
 * has no marker resolves to `null` and is dropped (no fabricated handle).
 */
const decodeContentFieldValue = (
  raw: string,
  shape: FieldShape,
  guidIndex: GuidHandleIndex
): ContentFieldValue | null => {
  switch (shape) {
    case "text":
    case "richText":
      return { shape, value: raw };
    case "enum":
      return raw === "" ? null : { shape: "enum", value: raw };
    case "boolean":
      return { shape: "boolean", value: raw === "1" };
    case "number": {
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? { shape: "number", value: n } : null;
    }
    case "integer": {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? { shape: "integer", value: n } : null;
    }
    case "date": {
      const iso = decodeSitecoreDateToIso(raw, "date");
      return iso === undefined ? null : { shape: "date", value: iso };
    }
    case "datetime": {
      const iso = decodeSitecoreDateToIso(raw, "datetime");
      return iso === undefined ? null : { shape: "datetime", value: iso };
    }
    case "image": {
      const img = decodeImageXml(raw);
      return img === undefined ? null : { shape: "image", ...img };
    }
    case "link": {
      const ext = decodeExternalLinkXml(raw);
      if (ext !== undefined) return { shape: "link-external", ...ext };
      const internal = decodeInternalLinkXml(raw, guidIndex);
      if (internal !== undefined) return { shape: "link-internal", ...internal };
      return null;
    }
    case "reference": {
      const refs: string[] = [];
      for (const guid of raw.split("|")) {
        const norm = normalizeGuid(guid);
        if (!norm) continue;
        const handle = guidIndex.get(norm);
        if (handle !== undefined) refs.push(handle);
      }
      return refs.length > 0 ? { shape: "reference", refs } : null;
    }
  }
};

/**
 * Per-field decoder metadata: the abstract shape and the storage axis the
 * template declares. The walker uses `storage` to bucket field values into
 * `shared` vs. per-(language, version) cells before round-tripping.
 */
interface TemplateFieldInfo {
  shape: FieldShape;
  storage: "shared" | "unversioned" | "versioned";
}
/** `lowercase(fieldName) → TemplateFieldInfo` for one Sitecore template. */
type TemplateFieldShapes = Map<string, TemplateFieldInfo>;

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
const getTemplateFieldShapes = async (
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
const authorableFieldsOf = (item: RemoteItem): RemoteItem["fields"] =>
  item.fields.filter((f) => isItemAuthorableField(f.name));

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
const contentItemFromItem = async (
  item: RemoteItem,
  templateHandle: string,
  client: AuthoringApiClient,
  guidIndex: GuidHandleIndex,
  templateShapeCache: Map<string, TemplateFieldShapes>,
  tenantLanguages: readonly string[]
): Promise<ContentItemRecipe | null> => {
  if (tenantLanguages.length === 0) return null;

  const shapes = await getTemplateFieldShapes(item.templateId, client, templateShapeCache);

  // Pass 1 — per-language latest-version read. One round trip total.
  const perLang = await client.getItemPerLanguageBatch({ itemId: item.itemId }, tenantLanguages);
  const populated = perLang.filter((row) => row.item !== null && row.versions.length > 0);
  if (populated.length === 0) return null;

  // Pass 2 — historic versions (any populated language with versions > 1).
  // Skip pass 2 entirely when every language is single-version.
  const historicRequests: Array<{ language: string; version: number }> = [];
  for (const row of populated) {
    for (const v of row.versions) {
      // The latest version came back in pass 1; only fetch the ones below it.
      if (v < row.versions[row.versions.length - 1]) {
        historicRequests.push({ language: row.language, version: v });
      }
    }
  }
  const historic =
    historicRequests.length > 0
      ? await client.getItemAtVersionsBatch({ itemId: item.itemId }, historicRequests)
      : [];
  // (language, version) → RemoteItem snapshot for historic versions.
  const historicByLangVer = new Map<string, RemoteItem>();
  for (let i = 0; i < historicRequests.length; i += 1) {
    const snap = historic[i];
    if (snap)
      historicByLangVer.set(`${historicRequests[i].language}|${historicRequests[i].version}`, snap);
  }

  /**
   * Decode the per-(lang, version) authorable field values for one snapshot
   * into the recipe's `{ fieldName → ContentFieldValue }` shape. Fields whose
   * name doesn't resolve to a known shape (template hasn't been walked, or
   * a non-template field) are skipped — we'd be guessing the shape.
   */
  const decodeVersionedFields = (snapshot: RemoteItem): Record<string, ContentFieldValue> => {
    const out: Record<string, ContentFieldValue> = {};
    for (const f of authorableFieldsOf(snapshot)) {
      // Versioned-bucket fields only: shared values surface separately
      // (they're already split by storage on the template-shape map).
      if (f.language === undefined && f.version === undefined) continue;
      if (f.name === undefined) continue;
      const info = shapes.get(f.name.toLowerCase());
      if (info === undefined) continue;
      if (info.storage === "shared") continue;
      const decoded = decodeContentFieldValue(f.value, info.shape, guidIndex);
      if (decoded !== null) out[f.name] = decoded;
    }
    return out;
  };

  /**
   * Decode the item-level `storage: shared` fields. Aggregated across pass 1's
   * results — shared values are language-agnostic, so the first occurrence
   * wins. (`storage: unversioned` is treated as `versioned` from the recipe's
   * perspective: it lives per-language and round-trips as a translation/version
   * field, not a shared one.)
   */
  const sharedFields: Record<string, ContentFieldValue> = {};
  for (const row of populated) {
    const snapshot = row.item;
    if (!snapshot) continue;
    for (const f of authorableFieldsOf(snapshot)) {
      if (f.language !== undefined || f.version !== undefined) continue;
      if (f.name === undefined || f.name in sharedFields) continue;
      const info = shapes.get(f.name.toLowerCase());
      if (info === undefined || info.storage !== "shared") continue;
      const decoded = decodeContentFieldValue(f.value, info.shape, guidIndex);
      if (decoded !== null) sharedFields[f.name] = decoded;
    }
  }

  /** Read the per-version `__Final Renderings` layout XML and decode to a Layout. */
  const layoutOfSnapshot = (snapshot: RemoteItem): Layout | undefined => {
    const xml = finalLayoutXmlOf(snapshot);
    if (xml === "") return undefined;
    const layout = layoutFromXml(xml, guidIndex);
    return Object.keys(layout.placeholders).length === 0 ? undefined : layout;
  };

  /** Read the per-version `__Created` date and decode to ISO datetime. */
  const dateOfSnapshot = (snapshot: RemoteItem): string | undefined => {
    const raw = fieldValueByName(snapshot, "__Created");
    if (raw === undefined || raw === "") return undefined;
    return decodeSitecoreDateToIso(raw, "datetime");
  };

  // Mode decision: story when any language carries >1 version OR any version
  // carries a layout (the simple-mode wire shape doesn't encode item-level
  // layout, so layout-bearing CIs MUST round-trip as story).
  const anyMultiVersion = populated.some((row) => row.versions.length > 1);
  const anyLayout = (() => {
    for (const row of populated) {
      if (row.item && layoutOfSnapshot(row.item) !== undefined) return true;
    }
    for (const snapshot of historicByLangVer.values()) {
      if (layoutOfSnapshot(snapshot) !== undefined) return true;
    }
    return false;
  })();
  const isStory = anyMultiVersion || anyLayout;

  const displayName = fieldValue(item, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? item.name;
  const description = fieldValueByName(item, "__Long description");

  const base: ContentItemRecipe = {
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

  if (!isStory) {
    // Simple mode: default-language fields, other languages → translations.
    const DEFAULT_LANG = "en";
    const defaultRow = populated.find((row) => row.language === DEFAULT_LANG);
    if (defaultRow?.item) {
      base.fields = decodeVersionedFields(defaultRow.item);
    } else {
      // No `en` populated — promote the first populated language as the
      // primary so `fields` carries content; the recipe schema requires
      // `fields` as a `Record` (defaulting to `{}` is legal but degrades
      // round-trip). The translations branch then skips that promoted lang.
      const first = populated[0];
      if (first.item) base.fields = decodeVersionedFields(first.item);
    }
    const primaryLang = populated.some((r) => r.language === DEFAULT_LANG)
      ? DEFAULT_LANG
      : populated[0].language;
    const translations: Record<string, ContentTranslation> = {};
    for (const row of populated) {
      if (row.language === primaryLang) continue;
      if (!row.item) continue;
      const fields = decodeVersionedFields(row.item);
      if (Object.keys(fields).length > 0) translations[row.language] = { fields };
    }
    if (Object.keys(translations).length > 0) base.translations = translations;
    return base;
  }

  // Story mode: every (language, version) cell projects to a ContentVersion.
  // The schema requires `fields` (always present) — leave as `{}` and put all
  // content under `versions`.
  const versions: Record<string, ContentVersion[]> = {};
  for (const row of populated) {
    const entries: ContentVersion[] = [];
    for (const v of row.versions) {
      const isLatest = v === row.versions[row.versions.length - 1];
      const snapshot = isLatest ? row.item : historicByLangVer.get(`${row.language}|${v}`);
      if (!snapshot) continue;
      const entry: ContentVersion = { version: v, fields: decodeVersionedFields(snapshot) };
      const date = dateOfSnapshot(snapshot);
      if (date !== undefined) entry.date = date;
      const layout = layoutOfSnapshot(snapshot);
      if (layout !== undefined) entry.layout = layout;
      entries.push(entry);
    }
    if (entries.length > 0) versions[row.language] = entries;
  }
  if (Object.keys(versions).length > 0) base.versions = versions;
  return base;
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
const walkContentItemsTree = async (
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
        const recipe = await contentItemFromItem(
          child,
          templateHandle,
          client,
          guidIndex,
          templateShapeCache,
          tenantLanguages
        );
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

/**
 * Reverse-project every in-scope subtree under the configured roots into a
 * `Recipe[]` — all ten reverse-projectable kinds (see the module JSDoc).
 *
 * Order of work: the templates trees and enumerations first, then the
 * layout-bearing kinds. The layout-bearing walkers share a GUID→handle
 * marker index (`buildGuidHandleIndex`) built once up front — skipped
 * entirely when no layout-bearing root is configured, so an environment
 * without partial/page designs pays nothing for the index walk.
 *
 * Returns `null` only when the environment has *no* roots configured at all
 * — the signal `recipe-kind.ts` uses to report "this environment has no
 * recipe-projectable surface." Otherwise always returns the array, which may
 * legitimately be empty (roots configured but empty trees).
 *
 * @param roots  Content-tree roots resolved off the env profile.
 * @param client Authoring API read client (`getItem` / `getChildren`).
 */
export const readCurrentRecipes = async (
  roots: ReadCurrentRoots,
  client: AuthoringApiClient
): Promise<Recipe[] | null> => {
  const isSet = (r: string | undefined): r is string => typeof r === "string" && r.length > 0;
  const anyRootSet = [
    roots.componentsRoot,
    roots.contentModelsRoot,
    roots.pageTemplatesRoot,
    roots.templatesRoot,
    roots.enumerationsRoot,
    roots.partialDesignsRoot,
    roots.pageDesignsRoot,
    roots.pagesRoot,
    roots.placeholderSettingsRoot,
    roots.contentItemsRoot,
  ].some(isSet);
  if (!anyRootSet) {
    // No roots at all — the environment has no recipe-projectable surface.
    return null;
  }

  const recipes: Recipe[] = [];

  // A template is a component iff a rendering exists for it. Index renderings
  // once up front so the templates walk is a pure lookup.
  const renderingComponentNames = roots.renderingsRoot
    ? await collectRenderingComponentNames(roots.renderingsRoot, client)
    : new Set<string>();

  // Walk each distinct templates-tree root exactly once. `componentsRoot` and
  // `contentModelsRoot` are usually distinct paths; `templatesRoot` is the
  // legacy fallback and is only walked when neither bucket root is set (a
  // shared path would otherwise double-emit).
  const walkedPaths = new Set<string>();
  const walkTemplateRoot = async (
    path: string | undefined,
    isComponentsRoot: boolean,
    isContentModelsRoot: boolean
  ): Promise<void> => {
    if (!path || walkedPaths.has(path)) return;
    walkedPaths.add(path);
    recipes.push(
      ...(await walkTemplatesTree(
        path,
        client,
        renderingComponentNames,
        isComponentsRoot,
        isContentModelsRoot
      ))
    );
  };

  await walkTemplateRoot(roots.componentsRoot, true, false);
  await walkTemplateRoot(roots.contentModelsRoot, false, true);
  // Page templates live under their own root (usually a per-site folder
  // the flat templatesRoot walk wouldn't descend into). `walkedPaths`
  // dedups if it happens to coincide with another root.
  await walkTemplateRoot(roots.pageTemplatesRoot, false, false);
  // Only fall back to the flat templatesRoot when no bucket root covered it.
  if (!roots.componentsRoot && !roots.contentModelsRoot) {
    await walkTemplateRoot(roots.templatesRoot, false, false);
  }

  if (roots.enumerationsRoot) {
    recipes.push(...(await walkEnumerationsTree(roots.enumerationsRoot, client)));
  }

  // Layout-bearing kinds (partial-design, page-design, page) reference
  // renderings + datasources by GUID inside their layout XML; placeholder
  // `Allowed Controls` does too. Build the GUID→handle marker index once
  // before reverse-projecting any of them. Content items share the same
  // index for `reference` / `link-internal` resolution. Skip the
  // (potentially large) index walk entirely when no root needs it.
  const needsGuidIndex =
    isSet(roots.partialDesignsRoot) ||
    isSet(roots.pageDesignsRoot) ||
    isSet(roots.pagesRoot) ||
    isSet(roots.placeholderSettingsRoot) ||
    isSet(roots.contentItemsRoot);
  if (needsGuidIndex) {
    const guidIndex = await buildGuidHandleIndex(roots, client);
    if (roots.partialDesignsRoot) {
      recipes.push(...(await walkPartialDesignsTree(roots.partialDesignsRoot, client, guidIndex)));
    }
    if (roots.pageDesignsRoot) {
      recipes.push(...(await walkPageDesignsTree(roots.pageDesignsRoot, client, guidIndex)));
    }
    // Pages and content items both use the per-(lang, version) fan-out;
    // share one tenant-language fetch + one template-shape cache across them.
    // Best-effort tenant-language fetch: the client falls back to `["en"]`
    // when the Authoring schema doesn't expose the query (see
    // `getTenantLanguages` JSDoc).
    const needsMultiLangFetch = isSet(roots.pagesRoot) || isSet(roots.contentItemsRoot);
    const tenantLanguages = needsMultiLangFetch ? await client.getTenantLanguages() : [];
    const templateShapeCache = new Map<string, TemplateFieldShapes>();
    if (roots.pagesRoot) {
      recipes.push(
        ...(await walkPagesTree(
          roots.pagesRoot,
          client,
          guidIndex,
          templateShapeCache,
          tenantLanguages
        ))
      );
    }
    if (roots.placeholderSettingsRoot) {
      recipes.push(
        ...(await walkPlaceholderSettingsTree(roots.placeholderSettingsRoot, client, guidIndex))
      );
    }
    if (roots.contentItemsRoot) {
      recipes.push(
        ...(await walkContentItemsTree(
          roots.contentItemsRoot,
          client,
          guidIndex,
          templateShapeCache,
          tenantLanguages
        ))
      );
    }
  }

  return recipes;
};
