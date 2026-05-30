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
  /**
   * SXA `Rendering Folder` template — the conventional template for
   * organisational folders inside the renderings tree (sections,
   * Component Folders, Variants groupings). Distinct from the generic
   * FOLDER template; SXA's editor UI looks for this template when
   * walking the rendering tree.
   *
   * Verified against sandbox tenant `xmc-lizsitecore7e03-...` on
   * 2026-05-02 via Authoring API introspection — every section folder
   * under `/sitecore/layout/Renderings/Project/<site>/` conforms to
   * this template.
   */
  RENDERING_FOLDER: "7ee0975b-0698-493e-b3a2-0b2ef33d0522",
  /**
   * SXA `HeadlessVariantsGrouping` template — the top-level "Headless
   * Variants" folder under a site's `Presentation/` content tree.
   * Recipe-emitted variant trees use this for the root grouping AND
   * any section-level groupings under it (mirrors the templates tree's
   * section folders).
   *
   * Verified against sandbox tenant 2026-05-02:
   * `/sitecore/content/<siteCollection>/<site>/Presentation/Headless Variants`
   * conforms to this template.
   */
  HEADLESS_VARIANTS_GROUPING: "da26c636-96e1-45e4-88d6-3fcec70d5699",
  /**
   * SXA `HeadlessVariants` template — the per-rendering folder that
   * groups all variant definitions for a single rendering.
   *
   * Verified against sandbox tenant 2026-05-02:
   * `/sitecore/content/<siteCollection>/<site>/Presentation/Headless Variants/<RenderingName>/`
   * conforms to this template (e.g. Accordion, FeatureBanner, Promo).
   */
  HEADLESS_VARIANTS: "49c111d0-6867-4798-a724-1f103166e6e9",
  /**
   * SXA Headless `Variant Definition` template — each individual
   * rendering variant (e.g. `default`, `outline`, `BoxedAccordion`).
   *
   * Verified against sandbox tenant 2026-05-02 — every leaf item under
   * a `HeadlessVariants` rendering folder conforms to this template.
   * Replaces scai's earlier use of generic `FOLDER` for variant items,
   * which left the SXA editor unable to recognise them as variants.
   */
  VARIANT_DEFINITION: "4d50cdae-c2d9-4de8-b080-8f992bfb1b55",
  /**
   * SXA `Available Renderings Folder` — the parent grouping at
   * `/sitecore/content/<siteCollection>/<site>/Presentation/Available Renderings`.
   * Each child item conforms to `AVAILABLE_RENDERINGS` (below) and
   * lists a section's renderings via the `RENDERINGS` field.
   *
   * Verified against sandbox tenant 2026-05-02.
   */
  AVAILABLE_RENDERINGS_FOLDER: "26ec1d18-11b2-4dd9-8326-f6115f4fd7eb",
  /**
   * SXA `Available Renderings` — each section's whitelist of
   * renderings the SXA editor offers when composing pages. Stores
   * a pipe-separated list of rendering itemIds in the `RENDERINGS`
   * field (see `AVAILABLE_RENDERINGS_FIELDS.RENDERINGS`).
   *
   * Verified against sandbox tenant 2026-05-02 — `Page Content`,
   * `Forms`, `Navigation`, etc. under the site's
   * `Presentation/Available Renderings/` all conform to this.
   */
  AVAILABLE_RENDERINGS: "76da0a8d-fc7e-42b2-af1e-205b49e43f98",
} as const;

/**
 * Fields of the SXA `Available Renderings` template. The `RENDERINGS`
 * field is a multilist whose value is a pipe-separated string of
 * Sitecore-formatted itemIds (`{GUID}|{GUID}|{GUID}`). Each id points
 * at a rendering item — for our recipe-set, the renderings emitted
 * by every component-template recipe in the same `section`.
 *
 * Verified against sandbox tenant 2026-05-02 by introspecting the
 * `Page Content` Available Renderings item's own field.
 */
export const AVAILABLE_RENDERINGS_FIELDS = {
  RENDERINGS: "715ae6c0-71c8-4744-ab4f-65362d20ad65",
} as const;

/**
 * Sitecore `Placeholder` template (`/sitecore/templates/System/Layout/Placeholder`).
 * A Placeholder Settings item is the gate for "what renderings can
 * appear in this placeholder slot". Items conforming to this template
 * are leaves under a `Placeholder Settings Folder`; recipes target
 * them by their `Placeholder Key` field value (e.g. `headless-main`,
 * `sxa-footer`), not by their item name.
 *
 * Verified against sandbox tenant 2026-05-02 — every placeholder under
 * `/sitecore/content/<site>/Presentation/Placeholder Settings/...`
 * conforms to this template.
 */
export const PLACEHOLDER_TEMPLATE_ID = "d2a6884c-04d5-4089-a64e-d27ca9d68d4c";

/**
 * SXA `Placeholder Settings Folder` template
 * (`/sitecore/templates/Foundation/JSS Experience Accelerator/Placeholder
 * Settings/Placeholder Settings Folder`). The organisational folder
 * inside a Placeholder Settings tree — recipe-defined placeholder
 * grouping folders conform to this so they inherit its `__Standard
 * Values` Insert Options (`Placeholder` + `Placeholder Settings
 * Folder`), giving authors the right right-click → Insert UX without
 * scai having to stamp `__Masters` explicitly.
 *
 * Verified against sandbox tenant (`xmc-lizsitecore088b-…`) on
 * 2026-05-15 via Authoring API introspection — the `Placeholder
 * Settings` root and its `Partial Design` child both conform to it, and
 * the template's SV carries
 * `__Masters = {D2A6884C-…}|{52288E39-…}` (see
 * `scripts/_recon-page-template.cjs`).
 */
export const PLACEHOLDER_SETTINGS_FOLDER_TEMPLATE_ID = "52288e39-7830-4694-b62d-32a54c6ef7ba";

/**
 * Fields of the Sitecore `Placeholder` template that recipes interact
 * with:
 *
 * - `PLACEHOLDER_KEY` (`Placeholder Key`) — identifying string used
 *   in layout XML / page-design slot definitions. Recipe `placeholders`
 *   entries match against this value.
 * - `ALLOWED_CONTROLS` (`Allowed Controls`) — pipe-separated multilist
 *   of rendering itemIds. Pages reads this when offering renderings
 *   for the placeholder; without our renderings on this list, the
 *   user can't add the component to the slot.
 *
 * Verified against sandbox tenant 2026-05-02 by introspecting
 * `/sitecore/content/starters/e2e/Presentation/Placeholder Settings/Partial Design/Footer`.
 */
export const PLACEHOLDER_FIELDS = {
  PLACEHOLDER_KEY: "7256bdab-1fd2-49dd-b205-cb4873d2917c",
  ALLOWED_CONTROLS: "e391b526-d0c5-439d-803e-17512eae6222",
} as const;

/**
 * SXA Foundation base templates that every component-template recipe
 * (Phase 1 component template + standard values) must inherit so the
 * SXA editor framework recognises the item as a component:
 *
 * - `_PerSiteStandardValues` ({44A022DB-56D3-419A-B43B-E27E4D8E9C41})
 *   wires the per-site standard-values mechanism.
 * - `_HorizonDatasourceGrouping` ({D0F6BE14-2A2D-4C56-ACB5-80CAA573B8E2})
 *   exposes datasource grouping/defaults to the Pages (Horizon) editor.
 * - `_PublishingGroupingTemplate` ({8BA7DAC6-32ED-4378-BD9E-5DA5B0F9848D})
 *   wires the publishing/release grouping that SXA editors expect.
 *
 * Verified by introspecting `AccordionBlock` (and other components)
 * in tenant `xmc-lizsitecore7e03-...` on 2026-05-02. Content-template
 * (datasource-only) recipes deliberately exclude these — they're
 * datasource items, not full SXA components.
 */
export const SXA_COMPONENT_BASE_TEMPLATES = [
  "44a022db-56d3-419a-b43b-e27e4d8e9c41",
  "d0f6be14-2a2d-4c56-acb5-80caa573b8e2",
  "8ba7dac6-32ed-4378-bd9e-5da5b0f9848d",
] as const;

/**
 * Sitecore Standard Template — the implicit base of every template that
 * doesn't declare its own `__Base template`.
 */
export const STANDARD_TEMPLATE_ID = "1930bbeb-7805-471a-a3be-4858ac7cf696";

/**
 * SXA Headless params-template bases — what every Pages-renderable
 * rendering-parameters template must inherit so the editor recognises
 * the template as a parameters shape and populates the rendering
 * parameters dialog with its fields.
 *
 * Verified by introspecting the working `LinkList` params template in
 * tenant `xmc-lizsitecore7e03-...` on 2026-05-03 — its `__Base templates`
 * field carried exactly these three GUIDs:
 *
 *   - `4247AAD4-EBDE-4994-998F-E067A51B1FE4` — `BaseRenderingParameters`
 *     at `/sitecore/templates/Foundation/JSS Experience Accelerator/
 *     Presentation/Rendering Parameters/BaseRenderingParameters`. The
 *     SXA Headless analog of vanilla Sitecore's "Standard Rendering
 *     Parameters" — chains in `IStyling`, `IComponentVariant`, and
 *     other facets the SXA editor scans for.
 *   - `44A022DB-56D3-419A-B43B-E27E4D8E9C41` — `_PerSiteStandardValues`
 *     (also part of `SXA_COMPONENT_BASE_TEMPLATES`). Wires the per-site
 *     standard-values mechanism so per-site SV inheritance works for
 *     params items too.
 *   - `3DB3EB10-F8D0-4CC9-BE26-18CE7B139EC8` — additional SXA Headless
 *     base (purpose not yet pinned, but consistently present on
 *     working SXA Headless params templates; safer to mirror than
 *     omit).
 *
 * Vanilla Sitecore "Standard Rendering Parameters"
 * (`8CA06D6A-B353-44E8-BC31-B528C7306971`) is *not* used by SXA Headless
 * — confirmed via the introspected LinkList template, which doesn't
 * inherit it. Earlier emission attempted to use it and the params
 * dialog stayed empty in Pages.
 */
export const SXA_HEADLESS_PARAMS_BASE_TEMPLATES = [
  "4247aad4-ebde-4994-998f-e067a51b1fe4",
  "44a022db-56d3-419a-b43b-e27e4d8e9c41",
  "3db3eb10-f8d0-4cc9-be26-18ce7b139ec8",
] as const;

/**
 * SXA `_IDynamicPlaceholder` interface template — base-template extension
 * for rendering parameters templates that need to support nested dynamic
 * placeholders. Contributes a `DynamicPlaceholderID` field; the Pages
 * chrome auto-populates this field with a per-placement integer when an
 * author drops the rendering, and the layout service emits the resolved
 * value as the `DynamicPlaceholderId` rendering parameter. The headless
 * SDK uses that parameter to resolve concrete `<slot>-<id>` placeholder
 * keys against the `<slot>-{*}` template defined on the rendering.
 *
 * Without this base template, the parameters template has no
 * `DynamicPlaceholderID` field, the chrome has nowhere to write the ID,
 * and nested children either fail to bind in Pages or persist against
 * the wrong slot key — symptom is a container rendered childless in
 * layout service with the SDK warning
 * `Placeholder '<slot>-1' was not found in the current rendering data`.
 *
 * Setting `IsRenderingsWithDynamicPlaceholders=true` in the rendering's
 * `OtherProperties` is necessary-but-not-sufficient. Both halves are
 * required; both are emitted by the `dynamicPlaceholders: true` flag on
 * `ComponentTemplateRecipe`.
 *
 * Path: `/sitecore/templates/Foundation/Experience Accelerator/Dynamic Placeholders/Rendering Parameters/IDynamicPlaceholder`.
 * Captured 2026-05-30 by introspecting the tenant via
 * `_recon-page-template.cjs item <path>` — Foundation template, GUID is
 * stable across tenants (same identity model as the other SXA bases in
 * this module).
 */
export const IDYNAMIC_PLACEHOLDER_TEMPLATE_ID = "5c74e985-e055-43ff-b28c-db6c6a6450a2";

/**
 * SXA Headless page base templates — what a recipe-emitted page template
 * must inherit so XM Cloud Pages recognises items conforming to it as
 * authorable pages: they pick up the layout/presentation fields, the
 * navigation facet, taxonomy tagging, the page-design binding, and
 * sitemap metadata.
 *
 * This is exactly the base set the OOTB per-site `Page` template
 * carries. Captured 2026-05-15 by walking the `__Base template` chain of
 * `/sitecore/templates/Project/demo-registry/Page` on the sandbox tenant
 * (`xmc-lizsitecore088b-…`) via Authoring API introspection — see
 * `scripts/_recon-page-template.cjs`. All five are SXA Foundation
 * templates, so the GUIDs are stable across tenants (same identity model
 * as `SXA_COMPONENT_BASE_TEMPLATES`).
 *
 *   - `Base Page`  ({47151711-26CA-434E-8132-D3E0B7D26683}) —
 *     `/sitecore/templates/Foundation/JSS Experience Accelerator/Multisite/Base Page`.
 *     The SXA Headless page base; chains in the EXA `Page` →
 *     Standard template, so the Layout / Appearance / Publishing
 *     sections all arrive transitively.
 *   - `_Navigable`  ({371D5FBB-5498-4D94-AB2B-E3B70EEBE78C}) —
 *     navigation facet: `NavigationTitle`, `ChangeFrequency`, `Priority`.
 *   - `_Taggable`  ({F39A594A-7BC9-4DB0-BAA1-88543409C1F9}) —
 *     taxonomy tagging facet.
 *   - `_Designable`  ({6650FB34-7EA1-4245-A919-5CC0F002A6D7}) —
 *     carries the `Page Design` Droplink field (the per-item
 *     page-design override). The default template→design binding is
 *     the `TemplatesMapping` aggregate on the Page Designs root, not
 *     this field — see `compileRecipeSet`.
 *   - `_Sitemap`  ({4414A1F9-826A-4647-8DF4-ED6A95E64C43}) —
 *     sitemap metadata facet.
 */
export const SXA_HEADLESS_PAGE_BASE_TEMPLATES = [
  "47151711-26ca-434e-8132-d3e0b7d26683",
  "371d5fbb-5498-4d94-ab2b-e3b70eebe78c",
  "f39a594a-7bc9-4db0-baa1-88543409c1f9",
  "6650fb34-7ea1-4245-a919-5cc0f002a6d7",
  "4414a1f9-826a-4647-8df4-ed6a95e64c43",
] as const;

/**
 * `Page Design` field on the SXA `_Designable` facet — a Droplink whose
 * Source is `query:$pageDesigns//*[@@templatename='Page Design']`. The
 * per-item page-design override; recipe-emitted page templates leave it
 * unset (the default binding flows through the Page Designs root's
 * `TemplatesMapping`). Captured in the same 2026-05-15 recon pass.
 */
export const PAGE_DESIGN_FIELD_ID = "24171bf1-c0e1-480e-be76-4c0a1876f916";

/**
 * SXA Headless JSON `Layout` definition item (`/sitecore/layout/Layouts/
 * Project/.../JSON Layout`). A page's `__Renderings` field wraps its
 * device element with `l="{this}"` — `<d id="{device}" l="{layout}" />`.
 * Recipe-emitted page templates stamp it on the `__Standard Values`
 * layout shell so pages conforming to them render through the headless
 * JSON layout pipeline.
 *
 * Captured 2026-05-15 from the `Page` template's `__Standard Values`
 * `__Renderings` field on the sandbox tenant. SXA-shipped item, stable
 * GUID across tenants.
 */
export const SXA_JSON_LAYOUT_ID = "96e5f4ba-a2cf-4a4c-a4e7-64da88226362";

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
  /**
   * `Shared` toggle on a Template Field — `"1"` makes the field's
   * value shared across all language versions and numeric versions of
   * any item conforming to the template. Verified against the canonical
   * `click-click-launch/Presentation/Enumeration/Enumeration/Value`
   * field item, where the enumeration `Value` field is shared (per-item
   * value, not per-language). GUID is the well-known Sitecore built-in.
   */
  SHARED: "be351a73-fcb0-4213-93fa-c302d8ab4f51",
  /**
   * `Unversioned` toggle on a Template Field — `"1"` makes the field's
   * value per-language but shared across numbered versions (vs `SHARED`,
   * which is one value for the whole item). Verified against the live
   * `test` tenant via Authoring API introspection on 2026-05-15. GUID is
   * the well-known Sitecore built-in.
   */
  UNVERSIONED: "39847666-389d-409b-95bd-f2016f11eed5",
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
  /**
   * "Placeholder" shared field — singular — on the SXA Headless
   * Json Rendering template. Pipe-separated list of placeholder keys
   * this rendering exposes (e.g. `container-{*}|footer-{*}`).
   *
   * SXA Headless reads this field to know which slots a rendering
   * declares; without it the layout service does NOT serialise any
   * `placeholders` map for the rendering, and the headless SDK's
   * `getPlaceholderRenderings` walks an empty object and warns
   * `Placeholder '<slot>-1' was not found in the current rendering data`.
   *
   * Distinct from the Placeholder Settings items at
   * `placeholderSettingsRoot` — those carry per-key allow-lists and
   * icons for the editor toolbox. Both are needed: settings items so
   * the toolbox shows the right insertable renderings, and this
   * field so SXA enumerates the slots in the first place.
   *
   * Sandbox-verified 2026-05-31 by introspecting the
   * `/sitecore/templates/Foundation/JavaScript Services/Json Rendering`
   * template (itemId 04646a89-996f-4ee7-878a-ffdbf1f0ef0d) on the
   * agents tenant. Note the singular name — an earlier guess used
   * the plural CMS-shaped "Placeholders" field with GUID
   * `b687328e-ca12-414d-a78e-6b4e6dca38fa`, which Authoring GraphQL
   * rejects as "field not found" because the Headless Json Rendering
   * template doesn't inherit the standard System/Layout/Rendering's
   * plural variant.
   */
  PLACEHOLDER: "592a1ce7-abe0-4986-9783-0a34f3961dc0",
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

/**
 * Default icon for component-shaped recipe items — SXA Headless's
 * built-in component icon. Verified against live tenant 2026-05-02:
 * real component templates and rendering items in healthy SXA sites
 * (e.g. `AccordionBlock`, `Accordion`) carry this value on `__Icon`.
 *
 * Used for: component templates, parameters templates, rendering
 * items, and (as the fallback) any other recipe-emitted item that
 * doesn't override.
 */
export const DEFAULT_ICON = "office/32x32/elements3.png";

/**
 * Icon for folder-shaped recipe items — Sitecore's standard folder
 * icon. Real SXA tenants leave the icon blank on per-site folders
 * (Components, Renderings, Variants groupings) and inherit the
 * underlying template's icon, but recipe-emitted items don't have
 * that template inheritance set up the same way, so we stamp this
 * explicitly to give the SXA editor's tree a usable icon for every
 * recipe-created folder.
 *
 * Applied to: Components/<section> templates folder, Component
 * Folders bucket, Presentation Parameters bucket, renderings-tree
 * section folder, Headless Variants section grouping, per-rendering
 * Headless Variants folder.
 *
 * NOT applied to Available Renderings section items — those use the
 * SXA `Available Renderings` template (not a Folder template), and
 * its template-level icon shows through correctly without an explicit
 * `__Icon` override.
 */
export const FOLDER_ICON = "office/16x16/folder.png";

/**
 * Icon stamped on the per-site `Enumerations Folder` and `Enumeration`
 * templates emitted by `ensureEnumerationTemplates`. Matches the icon
 * SXA Headless's OOTB Enumeration templates carry on starter sites
 * (verified 2026-05-03 against
 * `/sitecore/templates/Project/click-click-launch/Presentation/Enumeration`),
 * so the SXA editor recognises enum items as enumeration entries — not
 * generic folders — and the content tree renders the "E" key glyph.
 *
 * Applied at the template level, NOT on individual value items: value
 * items conform to the per-site `Enumeration` template and inherit the
 * icon through template-level inheritance.
 */
export const ENUMERATION_ICON = "office/32x32/keyboard_key_e.png";

/**
 * Icon for recipe-emitted page templates — matches the icon the OOTB
 * SXA Headless `Page` template carries (`Office/32x32/document_text.png`,
 * verified 2026-05-15 on the sandbox tenant), so page templates read as
 * pages — not generic data templates — in the content-tree.
 */
export const PAGE_TEMPLATE_ICON = "Office/32x32/document_text.png";
