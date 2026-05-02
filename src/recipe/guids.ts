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

/** Internal: lets the test prove `NAMESPACE_ROOT` matches its derivation. */
export const _deriveNamespaceRoot = (): string => uuidv5("registry.sitecoreai.dev", DNS_NAMESPACE);

export const templateId = (handle: string): string => uuidv5(handle, NAMESPACE_TEMPLATE);

export const renderingId = (handle: string): string => uuidv5(handle, NAMESPACE_RENDERING);

export const paramsTemplateId = (handle: string): string =>
  uuidv5(`${handle}::params`, NAMESPACE_TEMPLATE);

export const partialDesignId = (handle: string): string => uuidv5(handle, NAMESPACE_PARTIAL_DESIGN);

export const pageDesignId = (handle: string): string => uuidv5(handle, NAMESPACE_PAGE_DESIGN);

export const siteBranchId = (handle: string): string => uuidv5(handle, NAMESPACE_SITE_BRANCH);

export const contentItemId = (handle: string): string => uuidv5(handle, NAMESPACE_CONTENT_ITEM);

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

/** Sections are scoped under their template; the seed is `section:<name>`. */
export const sectionId = (handle: string, sectionName: string): string =>
  uuidv5(`section:${sectionName}`, templateId(handle));

/** Fields are scoped under their template; the seed is the field name. */
export const fieldId = (handle: string, fieldName: string): string =>
  uuidv5(fieldName, templateId(handle));

/** Sections of the parameters template scope under `paramsTemplateId`. */
export const paramsSectionId = (handle: string, sectionName: string): string =>
  uuidv5(`section:${sectionName}`, paramsTemplateId(handle));

/** Fields of the parameters template scope under `paramsTemplateId`. */
export const paramsFieldId = (handle: string, fieldName: string): string =>
  uuidv5(fieldName, paramsTemplateId(handle));

/** Variants folder lives under the rendering item: <Rendering>/Variants. */
export const variantsFolderId = (handle: string): string =>
  uuidv5("__variants", renderingId(handle));

/** Each Variant item lives under the Variants folder. */
export const variantId = (handle: string, variantName: string): string =>
  uuidv5(variantName, variantsFolderId(handle));

/**
 * Standard values is a child of the template whose template-of is the
 * template's own ID. The GUID is derived from the template ID with the
 * `__standard-values` seed.
 */
export const standardValuesId = (handle: string): string =>
  uuidv5("__standard-values", templateId(handle));

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
export const componentFolderTemplateId = (componentHandle: string): string =>
  uuidv5(`${componentHandle}::folder`, NAMESPACE_TEMPLATE);

/**
 * Standard-values item refKey for a component folder template. Same
 * derivation pattern as `standardValuesId(handle)` (seed
 * `__standard-values`, scope under the folder template's id) but
 * differentiated by the folder template's distinct namespace.
 */
export const componentFolderStandardValuesId = (componentHandle: string): string =>
  uuidv5("__standard-values", componentFolderTemplateId(componentHandle));

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
