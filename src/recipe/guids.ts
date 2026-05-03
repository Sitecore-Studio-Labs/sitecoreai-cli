import { v5 as uuidv5 } from "uuid";

/**
 * Deterministic GUID derivation for recipe-emitted Sitecore items.
 *
 * Every item GUID is a uuidv5 hash of (a kind-namespace, a stable seed).
 * Same recipe inputs produce the same GUIDs forever — that's how recipe
 * pushes are idempotent without server-side state.
 *
 * The namespacing tree is:
 *
 *   DNS                      RFC 4122 DNS namespace
 *     └── NAMESPACE_ROOT     uuidv5(DNS, "registry.sitecoreai.dev")
 *           ├── TEMPLATE         uuidv5(ROOT, "template")
 *           ├── RENDERING        uuidv5(ROOT, "rendering")
 *           ├── PARTIAL_DESIGN   uuidv5(ROOT, "partial-design")
 *           ├── PAGE_DESIGN      uuidv5(ROOT, "page-design")
 *           ├── SITE_BRANCH      uuidv5(ROOT, "site-branch")
 *           └── CONTENT_ITEM     uuidv5(ROOT, "content-item")
 *
 * The `handle` of a recipe (e.g. `cta-button@1`) is load-bearing forever:
 * a different handle = a different template. Versioning is pinned;
 * `cta-button@1` → `cta-button@2` is a *new* template.
 *
 * Component-shape items (templates, renderings, params templates, partial /
 * page / content items, component-folder templates and everything chained
 * off them — fields, sections, variants, standard-values) are also
 * **site-scoped**. The seed is `<site>::<handle>`, so the same recipe
 * pushed to two sites produces two distinct sets of items at distinct
 * paths under each site's `Project/<site>/` subtree. Without this scoping
 * a second site's push would collide on Sitecore's globally-unique GUID
 * constraint with the first site's items.
 */

/** RFC 4122 DNS namespace. */
const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * Frozen at v1. Hardcoded literal so repo edits to derivation logic can't
 * silently re-namespace existing tenants. The `__namespace_root_is_frozen`
 * test asserts this matches `uuidv5(DNS, "registry.sitecoreai.dev")`.
 */
export const NAMESPACE_ROOT = "d6c28e9f-21f3-56ee-ada3-f2a947c3d475";

export const NAMESPACE_TEMPLATE = uuidv5("template", NAMESPACE_ROOT);
export const NAMESPACE_RENDERING = uuidv5("rendering", NAMESPACE_ROOT);
export const NAMESPACE_PARTIAL_DESIGN = uuidv5("partial-design", NAMESPACE_ROOT);
export const NAMESPACE_PAGE_DESIGN = uuidv5("page-design", NAMESPACE_ROOT);
export const NAMESPACE_SITE_BRANCH = uuidv5("site-branch", NAMESPACE_ROOT);
export const NAMESPACE_CONTENT_ITEM = uuidv5("content-item", NAMESPACE_ROOT);
export const NAMESPACE_SITE = uuidv5("site", NAMESPACE_ROOT);
export const NAMESPACE_ENUMERATION = uuidv5("enumeration", NAMESPACE_ROOT);

/** Internal: lets the test prove `NAMESPACE_ROOT` matches its derivation. */
export const _deriveNamespaceRoot = (): string => uuidv5("registry.sitecoreai.dev", DNS_NAMESPACE);

export const templateId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_TEMPLATE);

export const renderingId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_RENDERING);

export const paramsTemplateId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}::params`, NAMESPACE_TEMPLATE);

export const partialDesignId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_PARTIAL_DESIGN);

export const pageDesignId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_PAGE_DESIGN);

export const siteBranchId = (handle: string): string => uuidv5(handle, NAMESPACE_SITE_BRANCH);

export const contentItemId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_CONTENT_ITEM);

/**
 * Recipe-internal refKey for a `SiteRecipe`'s site item. The actual
 * Sitecore site itemId is server-assigned by the Sites API at
 * `createSite` time; this refKey is the IR's identity for cross-op
 * resolution (dictionary phrases, taxonomy tags scoped under the site
 * inherit it).
 */
export const siteId = (handle: string): string => uuidv5(handle, NAMESPACE_SITE);

/**
 * Recipe-internal refKey for a dictionary phrase item under a site.
 * SXA's Site Wizard materialises `<site>/Dictionary/<phraseName>` based
 * on the SiteTemplate's dictionary defaults; SiteRecipe's
 * `dictionaryOverrides` writes the Phrase field on those existing
 * items. The executor seeds this refKey via cross-recipe path lookup
 * after `CreateSiteFromTemplate` materialises the site.
 */
export const dictionaryPhraseId = (siteHandle: string, phraseName: string): string =>
  uuidv5(`dictionary:${phraseName}`, siteId(siteHandle));

/**
 * Recipe-internal refKey for a taxonomy folder (root) under a site.
 * Mirror of `dictionaryPhraseId` for the taxonomy tree — late-seeded
 * after the site materialises.
 */
export const taxonomyFolderId = (siteHandle: string, rootName: string): string =>
  uuidv5(`taxonomy:${rootName}`, siteId(siteHandle));

/**
 * Recipe-internal refKey for a taxonomy tag item under a site's
 * taxonomy folder. Used when a SiteRecipe override list adds tags
 * beyond the SiteTemplate defaults — those become CreateItem ops
 * parented to the late-seeded taxonomy folder refKey.
 */
export const taxonomyTagId = (siteHandle: string, rootName: string, tagName: string): string =>
  uuidv5(`tag:${tagName}`, taxonomyFolderId(siteHandle, rootName));

/**
 * Stable refKey for the SXA Page Designs root item (the tenant-existing
 * item that holds the `TemplatesMapping` field). The orchestrator
 * pipeline-step seeds `crossRecipeRefs[<this>] = pageDesignsRoot` at
 * execute time so SetField ops targeting the mapping resolve correctly.
 *
 * Not a Sitecore concept — purely a refKey our IR uses to coordinate
 * with the executor's pre-seed mechanism.
 */
export const PAGE_DESIGNS_ROOT_REF_KEY = uuidv5("page-designs-root", NAMESPACE_ROOT);

/** Sections are scoped under their (site-scoped) template; seed `section:<name>`. */
export const sectionId = (site: string, handle: string, sectionName: string): string =>
  uuidv5(`section:${sectionName}`, templateId(site, handle));

/** Fields are scoped under their (site-scoped) template; the seed is the field name. */
export const fieldId = (site: string, handle: string, fieldName: string): string =>
  uuidv5(fieldName, templateId(site, handle));

/** Sections of the parameters template scope under (site-scoped) `paramsTemplateId`. */
export const paramsSectionId = (site: string, handle: string, sectionName: string): string =>
  uuidv5(`section:${sectionName}`, paramsTemplateId(site, handle));

/** Fields of the parameters template scope under (site-scoped) `paramsTemplateId`. */
export const paramsFieldId = (site: string, handle: string, fieldName: string): string =>
  uuidv5(fieldName, paramsTemplateId(site, handle));

/**
 * Per-rendering Headless Variants folder. Lives at
 * `<headlessVariantsRoot>/<section>/<RenderingName>/` and conforms to
 * SXA's `HeadlessVariants` template. The refKey seed is unchanged
 * from the legacy "under the rendering item" location (`__variants`
 * scoped to the rendering's id) so existing caches continue to
 * resolve — only the path/template changed.
 */
export const variantsFolderId = (site: string, handle: string): string =>
  uuidv5("__variants", renderingId(site, handle));

/**
 * Each Variant Definition item lives under the per-rendering
 * Headless Variants folder. Conforms to SXA's `Variant Definition`
 * template.
 */
export const variantId = (site: string, handle: string, variantName: string): string =>
  uuidv5(variantName, variantsFolderId(site, handle));

/**
 * Standard values is a child of the template whose template-of is the
 * template's own ID. The GUID is derived from the (site-scoped) template
 * ID with the `__standard-values` seed.
 */
export const standardValuesId = (site: string, handle: string): string =>
  uuidv5("__standard-values", templateId(site, handle));

/**
 * Standard values for a parameters template. Same `__standard-values`
 * seed pattern as `standardValuesId` but scoped under
 * `paramsTemplateId(site, handle)` so params-template SV items don't
 * collide with the component-template SV under the same handle.
 */
export const paramsStandardValuesId = (site: string, handle: string): string =>
  uuidv5("__standard-values", paramsTemplateId(site, handle));

/**
 * Enumeration root item — backs an `EnumerationRecipe`. Lives at
 * `<enumerationsRoot>/<EnumName>` per-site. Children are the enum's
 * value items (see `enumValueId`). Site-scoped seed `<site>::<handle>`
 * matches the rest of the per-component derivations so cross-site
 * pushes don't collide.
 */
export const enumerationFolderId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_ENUMERATION);

/**
 * Deterministic refKey for a single enumeration value item. Scopes
 * under the parent's refKey so the same value name (`primary`,
 * `default`, etc.) produces distinct GUIDs across enums:
 *
 *   - Shared enum: parent = `enumerationFolderId(site, handle)`.
 *   - Inline enum: parent = `inlineEnumFolderId(site, handle, fieldName)`.
 */
export const enumValueId = (
  parentRefKey: string,
  valueName: string,
): string => uuidv5(`enum-value:${valueName}`, parentRefKey);

/**
 * Inline enumeration folder — a per-field Folder item under
 * `<enumerationsRoot>` whose children are the field's value items.
 * Used when a field declares `shape: "enum"` with `values: [...]` and
 * NO `sitecore.enumHandle` (i.e. self-contained, scoped to one
 * field). Same content-tree shape as a shared `EnumerationRecipe`,
 * just keyed per-(recipe, field) so values don't cross-pollute.
 *
 * Distinct seed namespace from `enumerationFolderId(site, handle)` so
 * a shared enum at `color-scheme@1` and an inline enum on a field
 * named `ColorScheme` produce different GUIDs.
 */
export const inlineEnumFolderId = (
  site: string,
  recipeHandle: string,
  fieldName: string,
): string =>
  uuidv5(
    `${site}::${recipeHandle}::inline-enum::${fieldName}`,
    NAMESPACE_ENUMERATION,
  );

/**
 * Datasource items are scoped to a page recipe's id, keyed on slot path —
 * redeploys with regenerated mock content overwrite the same item.
 * Phase 1 doesn't emit these; defined here for forward-compat parity with
 * the planning doc.
 */
export const datasourceId = (pageItemId: string, slotPath: string): string =>
  uuidv5(slotPath, pageItemId);

/**
 * Project namespace — used for site-scoped folder identities (section
 * folders under `Components/<site>/Components/<section>`, etc.). Distinct
 * from the per-template namespaces because section folders are owned by
 * the *site*, not by any single template.
 */
export const NAMESPACE_PROJECT = uuidv5("project", NAMESPACE_ROOT);

/**
 * Deterministic refKey for a section folder under a site's
 * `Components/` bucket. Emitted as a `CreateOnly` `CreateItem` so
 * re-pushing a recipe set materialises the section once and is a
 * no-op thereafter. Identity scheme follows
 * `plans/recipe-site-folder-layout.md` § "Deterministic GUID
 * extensions".
 */
export const sectionFolderId = (site: string, section: string): string =>
  uuidv5(`${site}:Components:${section}`, NAMESPACE_PROJECT);

/**
 * Deterministic refKey for the renderings-side section folder under
 * `<renderingsRoot>/<section>/`. Distinct seed from the templates-side
 * section folder so the two don't share an identity (they are separate
 * Sitecore items in separate trees).
 */
export const renderingsSectionFolderId = (site: string, section: string): string =>
  uuidv5(`${site}:Renderings:${section}`, NAMESPACE_PROJECT);

/**
 * Deterministic refKey for an SXA Headless Variants section grouping
 * under `<headlessVariantsRoot>/<section>/`. Distinct from the
 * templates-side and renderings-side section folder seeds — separate
 * tree, separate Sitecore items, separate identity. Conforms to the
 * `HeadlessVariantsGrouping` template.
 */
export const headlessVariantsSectionFolderId = (site: string, section: string): string =>
  uuidv5(`${site}:HeadlessVariants:${section}`, NAMESPACE_PROJECT);

/**
 * Deterministic refKey for an SXA Available Renderings section item
 * (`<availableRenderingsRoot>/<section>`). Conforms to the
 * `AVAILABLE_RENDERINGS` template; aggregates every component-template
 * recipe in the section into one Renderings field. Idempotent across
 * runs — same `(site, section)` → same refKey forever.
 */
export const availableRenderingsSectionId = (site: string, section: string): string =>
  uuidv5(`${site}:AvailableRenderings:${section}`, NAMESPACE_PROJECT);

/**
 * Deterministic refKey for a "Component Folders" subfolder under a
 * site's `Components/<section>/` — an idempotent parent for the
 * generated `<Component> Folder` templates.
 */
export const componentFoldersBucketId = (site: string, section: string): string =>
  uuidv5(`${site}:Components:${section}:Component Folders`, NAMESPACE_PROJECT);

/**
 * Deterministic refKey for a "Presentation Parameters" subfolder under
 * a site's `Components/<section>/` — an idempotent parent for
 * standalone (and synthesised) Parameters templates.
 */
export const presentationParametersBucketId = (site: string, section: string): string =>
  uuidv5(`${site}:Components:${section}:Presentation Parameters`, NAMESPACE_PROJECT);

/**
 * Deterministic refKey for a `<Component> Folder` template emitted when
 * a `ComponentTemplateRecipe` declares `children:`. The Sitecore item
 * lands at `Components/<section>/Component Folders/<Component> Folder`;
 * the seed is `<componentHandle>::folder`, namespaced under
 * `NAMESPACE_TEMPLATE` so it shares the template-id family without
 * colliding with the component's own template id.
 */
export const componentFolderTemplateId = (site: string, componentHandle: string): string =>
  uuidv5(`${site}::${componentHandle}::folder`, NAMESPACE_TEMPLATE);

/**
 * Standard-values item refKey for a component folder template. Same
 * derivation pattern as `standardValuesId` (seed `__standard-values`,
 * scope under the folder template's id) but differentiated by the
 * folder template's distinct namespace.
 */
export const componentFolderStandardValuesId = (site: string, componentHandle: string): string =>
  uuidv5("__standard-values", componentFolderTemplateId(site, componentHandle));

/**
 * Deterministic refKey for a Content Models group folder under a
 * site's `Content Models/<group>/`. Materialised once via a CreateOnly
 * CreateItem when any content template in the recipe set carries
 * `meta.tax.group` matching this name.
 */
export const contentModelsGroupFolderId = (site: string, group: string): string =>
  uuidv5(`${site}:Content Models:${group}`, NAMESPACE_PROJECT);

/**
 * Deterministic refKey for a `SectionDefinitionRecipe` — the SXA
 * Available Rendering Section Definition item the registry's
 * `availableIn` bindings target. The section definition is typically
 * pre-existing on the tenant; the GUID is used as the cross-recipe
 * refKey so `AppendToMultiList` ops can resolve via the executor's
 * captured-itemId map.
 */
export const NAMESPACE_SECTION_DEFINITION = uuidv5("section-definition", NAMESPACE_ROOT);

export const sectionDefinitionId = (handle: string): string =>
  uuidv5(handle, NAMESPACE_SECTION_DEFINITION);
