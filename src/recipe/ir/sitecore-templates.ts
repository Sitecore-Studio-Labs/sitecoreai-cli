/**
 * Sitecore built-in template GUIDs that recipe-emitted items conform to.
 *
 * Sourced from `plans/sitecore-relationships.md` (orchestrator repo) — the
 * inventory document built from the xmcloud-starter-js Button bundle.
 * These are baked into Sitecore and are stable across tenants.
 *
 * Format: lowercase hex with hyphens, no curly braces. The reference
 * encoding (`{...}` curly form vs bare) is decided per-field at the IR
 * executor layer.
 */

export const SITECORE_TEMPLATES = {
  /** Item conforms to this when it *is* a data template. */
  TEMPLATE: "ab86861a-6030-46c5-b394-e8f99e8b87db",
  /** Item conforms to this when it is a section within a template. */
  TEMPLATE_SECTION: "e269fbb5-3750-427a-9149-7aa950b49301",
  /** Item conforms to this when it is a field within a section. */
  TEMPLATE_FIELD: "455a3e98-a627-4b40-8035-e683a0331ac7",
  /**
   * Item conforms to this when it is a rendering. The relationship inventory
   * groups View Rendering and JSON Rendering under one ID; differentiation
   * may be needed in later phases for headless-only tenants.
   */
  RENDERING: "04646a89-996f-4ee7-878a-ffdbf1f0ef0d",
  /**
   * Sitecore Folder template. Used in Phase 1 Variants Lite for both the
   * `<Rendering>/Variants` folder and each Variant item — bare items, no
   * SXA-specific structure. Phase 2+ should switch to the SXA Variant
   * Definition template once the GUID is sandbox-validated.
   */
  FOLDER: "a87a00b1-e6db-45ab-8b54-636fec3b5523",
  /**
   * Sitecore "Template Folder" template — the conventional template for
   * organisational folders inside the templates tree (sections,
   * Component Folders, Presentation Parameters subfolders, Content
   * Models groups). Distinct from the generic FOLDER above (which is
   * what the renderings tree uses). GUID is the well-known Sitecore
   * built-in:
   * `/sitecore/templates/System/Templates/Template folder` →
   * {0437FEE2-44C9-46A6-ABE9-28858D9FEE8C}.
   */
  TEMPLATE_FOLDER: "0437fee2-44c9-46a6-abe9-28858d9fee8c",
  /**
   * SXA Partial Design item template. Items conforming to this carry
   * SXA partial-design semantics: their layout XML is composed into
   * page designs via the `PartialDesigns` field.
   *
   * Verified against sandbox tenant (`xmc-lizsitecore088b-...`) on
   * 2026-04-30 via Authoring API introspection — the template lives at
   * `/sitecore/templates/Foundation/JSS Experience Accelerator/Presentation/Partial Design`.
   */
  PARTIAL_DESIGN: "fd2059fd-6043-4dfe-8c04-e2437ce87634",
  /**
   * SXA Page Design item template. Items conforming to this carry the
   * `PartialDesigns` field (pipe-separated GUIDs) and may carry their
   * own layout XML.
   *
   * Verified against sandbox tenant on 2026-04-30 via Authoring API
   * introspection — `/sitecore/templates/Foundation/JSS Experience
   * Accelerator/Presentation/Page Design`. The earlier documented value
   * `1105b8f8-1d40-4278-98ff-4e8b5b262af7` was wrong (close but
   * incorrect on the last 24 chars).
   */
  PAGE_DESIGN: "1105b8f8-1e00-426b-bf1f-c840742d827b",
  /**
   * SXA "Solution template" — what the SXA Site Wizard treats as a
   * Site Template. New sites are cloned from items conforming to this
   * template; the Sites API `createSite` flow references one by ID.
   *
   * Verified against sandbox tenant on 2026-05-01 via Authoring API
   * introspection. Built-in SXA Solution Templates live under
   * `/sitecore/system/Settings/Foundation/JSS Experience Accelerator/Scaffolding/Templates`
   * (e.g. "Empty Site"). Recipe-emitted SiteTemplates land in the same
   * area or a tenant-specific Scaffolding/Templates folder.
   *
   * Note: this template's fields (Site Modules, Tenant Modules, Name,
   * Description, Content, etc. — see SITE_TEMPLATE_FIELDS below) are
   * about MODULE composition, not direct page-template / page-design
   * lists. SXA's brand-shape model is module-based: a Solution template
   * lists modules, and modules carry the actual brand structure. Our
   * SiteTemplateRecipe schema (pageTemplates, pageDesigns,
   * insertOptionsMatrix, templatesToDesigns, dictionary, taxonomy) does
   * NOT map 1:1 to this — see the design-gap note in
   * `compileSiteTemplateRecipe`'s JSDoc.
   */
  SITE_TEMPLATE: "1b2dfd3b-f2f2-4f40-a75c-f6c2490919c4",
} as const;

/**
 * Sitecore Standard Template — the implicit base of every template that
 * doesn't declare its own `__Base template`.
 */
export const STANDARD_TEMPLATE_ID = "1930bbeb-7805-471a-a3be-4858ac7cf696";

/**
 * Stable system-field GUIDs that recipes need to write.
 * Auto-generated metadata fields (__Created, __Updated, __Revision, __Owner)
 * are deliberately omitted — Sitecore writes those.
 */
export const SYSTEM_FIELDS = {
  ICON: "06d5295c-ed2f-4a54-9bf2-26228d113318",
  BASE_TEMPLATE: "12c33f3f-86c5-43a5-aeb4-5598cec45116",
  STANDARD_VALUES: "f7d48a55-2158-4f02-9356-756654404f73",
  SORT_ORDER: "ba3f86a2-4a1c-4d78-b63d-91c2779c1b5e",
  DISPLAY_NAME: "b5e02ad9-d56f-4c41-a065-a133db87bdeb",
  /**
   * `__Masters` — the field that backs the CMS "Insert Options" UI.
   * Set on the standard-values item to a pipe-separated list of allowed
   * child template GUIDs. GUID verified against sandbox tenant
   * (`xmc-lizsitecore088b-...`) on 2026-04-30 via Authoring API
   * `templateField.templateFieldId` introspection.
   */
  INSERT_OPTIONS: "1172f251-dad4-4efb-a329-0c63500e4f1e",
} as const;

/** Field-definition shared fields on a Template Field item. */
export const TEMPLATE_FIELD_FIELDS = {
  TYPE: "ab162cc0-dc80-4abf-8871-998ee5d7ba32",
  SOURCE: "1eb8ae32-e190-44a6-968d-ed904c794ebf",
  TITLE: "19a69332-a23e-4e70-8d16-b2640cb24cc8",
} as const;

/**
 * Sitecore layout fields. `__Renderings` carries the shared layout
 * (applies across all language versions); `__Final Renderings` carries
 * the per-version final layout. Recipe-emitted partial designs and page
 * designs write their layout XML to `__Renderings` (shared, since these
 * are reusable design artifacts that don't vary per language version).
 *
 * Phase 4 page placements (PageRecipe, deferred) will write to
 * `__Final Renderings` so authors can override per-version.
 */
export const LAYOUT_FIELDS = {
  RENDERINGS: "f1a1fe9e-a60c-4ddb-a3a0-bb5b29fe732e",
  FINAL_RENDERINGS: "04bf00db-f5fb-41f7-8ab7-22408372a981",
} as const;

/**
 * Field GUIDs on the SXA `Solution template` (= Site Template) item.
 * Verified against sandbox on 2026-05-01 by inspecting the built-in
 * "Empty Site" template at `/sitecore/system/Settings/Foundation/JSS
 * Experience Accelerator/Scaffolding/Templates/Empty Site`.
 *
 * `SITE_MODULES` / `TENANT_MODULES` carry pipe-separated GUIDs of
 * *Module* items — the SXA model is "templates list modules; modules
 * hold the brand structure." Our `SiteTemplateRecipe` schema doesn't
 * model SXA modules yet; mapping is open work (see
 * `compileSiteTemplateRecipe` JSDoc).
 *
 * `BUILT_IN_TEMPLATE` is `"1"` on the SXA-shipped templates and `"0"`
 * on tenant-authored ones. Recipe-emitted templates set it to `"0"`.
 *
 * `CONTENT` is a JSON description of what the template includes
 * ("Pages: Home", "Components: SXA", etc.) — mostly for the Sites API
 * UI's preview pane. Recipes can leave it empty without breaking
 * createSite.
 */
export const SITE_TEMPLATE_FIELDS = {
  SITE_MODULES: "c262443b-653d-461d-96c8-7cfaa0ef2b2d",
  TENANT_MODULES: "41ac536a-923a-43f9-ac87-f3993f638125",
  NAME: "82e64b52-0b8a-4a38-8c78-530c5493814e",
  DESCRIPTION: "9f437e68-a84d-48ae-8ce1-a3e26c0b5e64",
  ENABLED: "0d21f818-1938-4cd8-b0a8-a44f73d69367",
  BUILT_IN_TEMPLATE: "a13aae24-a295-4cc3-b188-dfa59e2172a9",
  CONTENT: "da855368-e5f2-4932-ae55-7f8b08a5a205",
} as const;

/**
 * Per-site `SiteTemplate` field on a Headless Site item — points at
 * the SXA Site Template (Solution template) item the site was cloned
 * from. Captured on the sandbox in 2026-05-01 introspection.
 */
export const SITE_FIELDS = {
  SITE_TEMPLATE: "e2bf3c8d-a12e-45f4-98d6-a37f13bcf375",
  MODULES: "1230d2cb-4948-4d43-8a3b-b39978f6f1b3",
  NAME: "85a7501a-86d9-4243-9075-0b727c3a6db4",
  SITE_MEDIA_LIBRARY: "33d9005e-1f71-415f-b107-53b965c3b037",
  SITEMAP_MEDIA_ITEMS: "2b2fe9fd-78a6-40eb-b9f9-28409d8d3700",
} as const;

/**
 * SXA-specific fields on partial-design and page-design items, plus the
 * Page Designs root's templates-to-designs mapping field.
 *
 * Verified against sandbox tenant (`xmc-lizsitecore088b-...`) on
 * 2026-04-30 via Authoring API introspection — both prior documented
 * values were wrong:
 *   PARTIAL_DESIGNS:  was 1f57aae2-da42-49d7-bfaa-b4c4d8398eb4
 *   TEMPLATES_MAPPING: was 1aa90e5a-4f5b-43c9-b78b-d28a5beae65a
 *
 * `PartialDesigns` is defined on the SXA Page Design template's base
 * inheritance chain (section "Designing"); `TemplatesMapping` is
 * defined on the "Page Designs" folder template (the parent item that
 * owns the field, not on individual page-design items).
 */
export const COMPOSITION_FIELDS = {
  /** On a Page Design item: pipe-separated GUIDs of partial designs to inject. */
  PARTIAL_DESIGNS: "0966b999-0d0e-4278-acc9-9da69d461fe6",
  /** On the Page Designs root: URL-encoded {tplGuid}={designGuid}&… mapping. */
  TEMPLATES_MAPPING: "ba1f60d6-3deb-40cc-bb61-eec772279ee1",
} as const;

/**
 * Sitecore Default Device — the device GUID layout XML wraps with.
 * `<r><d id="{DEFAULT_DEVICE}">…<r .../>…</d></r>`.
 */
export const DEFAULT_DEVICE_ID = "fe5d7fdf-89c0-4d99-9aa3-b5fbd009c9f3";

/** Rendering-definition shared fields on a Rendering item. */
export const RENDERING_FIELDS = {
  COMPONENT_NAME: "037fe404-dd19-4bf7-8e30-4dadf68b27b0",
  DATASOURCE_TEMPLATE: "1a7c85e5-dc0b-490d-9187-bb1dbcb4c72f",
  DATASOURCE_LOCATION: "b5b27af1-25ef-405c-87ce-369b3a004016",
  PARAMETERS_TEMPLATE: "a77e8568-1ab3-44f1-a664-b7c37ec7810d",
  OPEN_PROPERTIES_AFTER_ADD: "7d8ae35f-9ed1-43b5-96a2-0a5f040d4e4e",
  OTHER_PROPERTIES: "e829c217-5e94-4306-9c48-2634b094fdc2",
} as const;

/**
 * Sitecore Dictionary Entry template fields. Used by SiteRecipe's
 * `dictionaryOverrides` — each phrase override SetFields the Phrase
 * value on an existing `<site>/Dictionary/<phraseName>` item that
 * SXA's Site Wizard materialises from the SiteTemplate's defaults.
 *
 * TODO (sandbox-verify): the PHRASE GUID below is the standard
 * Sitecore Dictionary Entry "Phrase" field. Validate via Authoring
 * API introspection during the first integration test push and
 * update if the SXA-shipped Dictionary Entry template diverges.
 */
export const DICTIONARY_ENTRY_FIELDS = {
  /** Field ID for "Phrase" — the translated string value on a Dictionary Entry. */
  PHRASE: "580c75a8-c01a-4580-83cb-987776ceb3af",
} as const;

/**
 * Available Rendering Section Definition template fields. The
 * `AVAILABLE_RENDERINGS` field is the multi-list that gates which
 * renderings show up in the section's group inside the Pages
 * "Toolbox" experience. Recipe `availableIn` bindings emit
 * `AppendToMultiList` ops against this field.
 *
 * TODO (sandbox-verify): the GUID below is a placeholder until we
 * inspect an XM Cloud Headless tenant. The executor matches by
 * `fieldName` ("Available Renderings") when the IR carries one, so
 * the placeholder GUID is only load-bearing for ref-encoding round-
 * trip; mismatches are tolerated. Update once verified.
 */
export const SECTION_DEFINITION_FIELDS = {
  AVAILABLE_RENDERINGS: "f56cab12-7f96-4a90-b0fa-e3b6f70b14db",
} as const;

export const DEFAULT_LANGUAGE = "en";
export const DEFAULT_VERSION = 1;
export const DEFAULT_ICON = "Office/32x32/document.png";
