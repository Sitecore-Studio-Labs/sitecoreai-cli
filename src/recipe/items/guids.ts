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

export const designParametersTemplateId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}::params`, NAMESPACE_TEMPLATE);

export const partialDesignId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_PARTIAL_DESIGN);

export const pageDesignId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_PAGE_DESIGN);

export const siteBranchId = (handle: string): string => uuidv5(handle, NAMESPACE_SITE_BRANCH);

export const contentItemId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_CONTENT_ITEM);

/**
 * Page item identity — a `PageRecipe`'s concrete page in the site
 * content tree. Distinct namespace from `contentItemId`: a page is a
 * navigable item conforming to a page template, not a shared datasource
 * item, and `datasourceId(pageItemId(...), slot)` scopes page-local
 * datasources beneath it. Site-scoped seed like the rest of the family.
 */
export const NAMESPACE_PAGE = uuidv5("page", NAMESPACE_ROOT);

export const pageItemId = (site: string, handle: string): string =>
  uuidv5(`${site}::${handle}`, NAMESPACE_PAGE);

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
 * Two emission paths land on this identity:
 *
 *   1. `SiteRecipe.dictionaryOverrides` — overrides an existing
 *      `<site>/Dictionary/<phraseName>` item. The executor seeds the
 *      refKey via cross-recipe path lookup after
 *      `CreateSiteFromTemplate` materialises the site's content tree
 *      and any DictionaryRecipes have landed.
 *   2. `compileDictionaryRecipe` — emits a `CreateItem` for each
 *      phrase entry under the dictionary's folder, parented to
 *      `dictionaryFolderId(siteHandle, recipeName)`.
 *
 * Both produce the same uuidv5 so override SetFields and the original
 * CreateItem agree on identity even when authored from different
 * recipes.
 */
export const dictionaryPhraseId = (siteHandle: string, phraseName: string): string =>
  uuidv5(`dictionary:${phraseName}`, siteId(siteHandle));

/**
 * Recipe-internal refKey for a `DictionaryRecipe`'s top-level
 * Dictionary Folder item. Lands at `<site>/Dictionary/<recipeName>/`
 * — sibling of the per-phrase Entry items. Per-DictionaryRecipe
 * grouping means multiple dictionaries can target the same host site
 * without colliding (each lands under its own subfolder).
 */
export const dictionaryFolderId = (siteHandle: string, recipeName: string): string =>
  uuidv5(`dictionary-folder:${recipeName}`, siteId(siteHandle));

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

/** Sections of the parameters template scope under (site-scoped) `designParametersTemplateId`. */
export const designParametersSectionId = (
  site: string,
  handle: string,
  sectionName: string
): string => uuidv5(`section:${sectionName}`, designParametersTemplateId(site, handle));

/** Fields of the parameters template scope under (site-scoped) `designParametersTemplateId`. */
export const designParameterFieldId = (site: string, handle: string, fieldName: string): string =>
  uuidv5(fieldName, designParametersTemplateId(site, handle));

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
 * `designParametersTemplateId(site, handle)` so params-template SV items don't
 * collide with the component-template SV under the same handle.
 */
export const designParametersStandardValuesId = (site: string, handle: string): string =>
  uuidv5("__standard-values", designParametersTemplateId(site, handle));

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
 * under the EnumerationRecipe's `enumerationFolderId(site, handle)` so
 * the same value name (`primary`, `default`, etc.) produces distinct
 * GUIDs across enums.
 */
export const enumValueId = (parentRefKey: string, valueName: string): string =>
  uuidv5(`enum-value:${valueName}`, parentRefKey);

/**
 * Per-site `Enumerations Folder` template. The folder layers in an
 * enumeration tree (root, per-section grouping, per-enum) all conform
 * to this template instead of Sitecore's generic Folder, so the SXA
 * editor recognises the layout and stamps the right icon. Site-scoped
 * because each site owns its own per-Project templates tree.
 */
export const enumerationsFolderTemplateId = (site: string): string =>
  uuidv5(`${site}::enumerations-folder-template`, NAMESPACE_TEMPLATE);

/**
 * Deterministic refKey for one segment of an
 * `EnumerationRecipe.location.folder` grouping path under
 * `<enumerationsRoot>/<…segments…>`. Conforms to the per-site
 * `Enumerations Folder` template. Site-scoped + keyed on the segment's
 * cumulative path so two recipes in the same push pointing at
 * `folder: "Theme/Color"` reuse the `Theme` and `Theme/Color` folders
 * rather than colliding.
 *
 * Pass the cumulative path (e.g. `"Theme"` then `"Theme/Color"`) — not
 * just the leaf segment — so each level gets its own GUID seeded by its
 * full position in the tree. This keeps two folders named `Color`
 * (one under `Theme`, one under `Layout`) distinct.
 *
 * Same `NAMESPACE_PROJECT` family as section folders / Component
 * Folders buckets — all "site organisational folders" with the same
 * identity model.
 */
export const enumerationsGroupingFolderId = (site: string, cumulativePath: string): string =>
  uuidv5(`${site}:Enumerations:${cumulativePath}`, NAMESPACE_PROJECT);

/**
 * Per-site `Enumeration` template. The per-enum container items
 * (`Color Scheme`, `Heading Size`, `Background Themes`, etc.) conform
 * to this template — i.e. each enumeration is itself an `Enumeration`,
 * and its leaf values live below it as `Enumeration Value` children.
 * Carries an inner `Enumeration` Section + `Value` Single-Line Text
 * shared field so each per-enum container item can store its
 * canonical default (driven by `EnumerationRecipe.default`). Site-
 * scoped for the same reason as `enumerationsFolderTemplateId`.
 */
export const enumerationTemplateId = (site: string): string =>
  uuidv5(`${site}::enumeration-template`, NAMESPACE_TEMPLATE);

/**
 * The single Template Section under the per-site `Enumeration`
 * template, named `"Enumeration"` (mirrors the Enumeration Value
 * template's inner section so the field path on both templates is
 * structurally identical: `<template>/Enumeration/Value`).
 */
export const enumerationContainerSectionId = (site: string): string =>
  uuidv5("section:Enumeration", enumerationTemplateId(site));

/**
 * The `Value` Template Field under the per-site `Enumeration` template's
 * `Enumeration` section. Stores each per-enum container item's default
 * value (`"primary"` for Color Scheme, `"md"` for Heading Size, etc.) —
 * driven by `EnumerationRecipe.default` at compile time. Edge consumers
 * reading the container directly resolve the default via this field.
 */
export const enumerationContainerValueFieldId = (site: string): string =>
  uuidv5("field:Value", enumerationTemplateId(site));

/**
 * Per-site `__Standard Values` item under the `Enumeration` template
 * definition. Linked via `SetStandardValues` so its Insert Options
 * propagate to every per-enum container item conforming to the
 * Enumeration template — authors can right-click `Color Scheme` →
 * Insert → Enumeration Value to add a new value without picking
 * templates from a long list.
 */
export const enumerationTemplateStandardValuesId = (site: string): string =>
  uuidv5(`${site}::enumeration-template-standard-values`, NAMESPACE_TEMPLATE);

/**
 * Per-site `Enumeration Value` template. The leaf value items (like
 * `primary`, `accent`, `lg`, `shooting-star`) conform to this template,
 * NOT to the `Enumeration` template — `Enumeration` is for the per-enum
 * container; `Enumeration Value` is for the leaves. Carries the inner
 * `Enumeration` Template Section + `Value` Template Field (defined
 * below) so each value item stores its actual enumeration string on
 * the `Value` shared field. Site-scoped.
 */
export const enumerationValueTemplateId = (site: string): string =>
  uuidv5(`${site}::enumeration-value-template`, NAMESPACE_TEMPLATE);

/**
 * The single Template Section under the per-site `Enumeration Value`
 * template, named `"Enumeration"` (matches the canonical
 * `click-click-launch/Presentation/Enumeration Value/Enumeration`).
 * Holds the `Value` field below. Scoped under
 * `enumerationValueTemplateId(site)` so the GUID is stable per-site
 * without colliding across sites.
 *
 * Function name retained for backwards compatibility with the prior
 * (broken) layout where this section lived under the Enumeration
 * template; the GUID it derives is now under the value template.
 */
export const enumerationTemplateSectionId = (site: string): string =>
  uuidv5("section:Enumeration", enumerationValueTemplateId(site));

/**
 * The `Value` Template Field under the per-site `Enumeration Value`
 * template's `Enumeration` section. Stores the actual enumeration
 * value (`"primary"`, `"shooting-star"`, etc.) on every value item
 * conforming to the Enumeration Value template. Scoped under
 * `enumerationValueTemplateId(site)` for stability.
 *
 * Function name retained for backwards compatibility — see
 * `enumerationTemplateSectionId` note above.
 */
export const enumerationTemplateValueFieldId = (site: string): string =>
  uuidv5("field:Value", enumerationValueTemplateId(site));

/**
 * Datasource items are scoped to a page recipe's id, keyed on slot path —
 * redeploys with regenerated mock content overwrite the same item.
 * These aren't emitted yet; defined here for forward-compat parity with
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
export const presentationDesignParametersBucketId = (site: string, section: string): string =>
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
 * Deterministic refKey for a page-template group folder under a site's
 * `<pageTemplatesRoot>/<group>/`. Materialised once via a CreateOnly
 * CreateItem when any `PageTemplateRecipe` in the set carries
 * `meta.tax.group` matching this name. Same identity family as
 * `contentModelsGroupFolderId` — a site-owned organisational folder.
 */
export const pageTemplatesGroupFolderId = (site: string, group: string): string =>
  uuidv5(`${site}:Page Templates:${group}`, NAMESPACE_PROJECT);

/**
 * Per-site shared Data Folder under `<contentItemsRoot>/<subfolder>`.
 * Emitted as a CreateOnly item by `compileComponentTemplateRecipe` when
 * a recipe declares a `site`-scoped datasource location with a
 * `subfolder`. Multiple recipes with the same subfolder share the
 * folder (idempotent emission via the `emittedFolders` set).
 */
export const siteDataFolderId = (site: string, subfolder: string): string =>
  uuidv5(`${site}::data-folder::${subfolder}`, NAMESPACE_PROJECT);

/**
 * Per-component Data Folder TEMPLATE emitted when a recipe declares a
 * site-scoped datasource location. Lands at
 * `Components/<section>/Data Folders/<Component> Data Folder`. The
 * Sitecore folder ITEM(s) at `<contentItemsRoot>/<subfolder>` conform
 * to this template (instead of the generic `Folder`) so its
 * `__Standard Values`'s Insert Options can restrict children to the
 * component's own datasource template — i.e. a "Badges" folder only
 * accepts Badge datasources when an author right-clicks → Insert.
 *
 * One template per recipe-handle (idempotent across multiple
 * site-scoped subfolders that share the same recipe). Mirrors
 * `componentFolderTemplateId` for `children:` declarations, but
 * keyed under a distinct seed so the two templates don't collide.
 */
export const siteDataFolderTemplateId = (site: string, recipeHandle: string): string =>
  uuidv5(`${site}::${recipeHandle}::data-folder-template`, NAMESPACE_TEMPLATE);

/**
 * Standard-values item refKey for a per-component Data Folder template.
 * Same derivation pattern as `standardValuesId` and
 * `componentFolderStandardValuesId` — seed `__standard-values` under
 * the folder template's own id.
 */
export const siteDataFolderStandardValuesId = (site: string, recipeHandle: string): string =>
  uuidv5("__standard-values", siteDataFolderTemplateId(site, recipeHandle));

/**
 * Per-(recipe, subfolder) Data Folder template — used when a recipe
 * declares site-scoped locations with DIFFERENT `allowedTemplates`
 * lists (the avatar-block case: page-Avatars accepts `avatar-block@1`,
 * site-Authors accepts `author@1`). One Insert Options list per
 * subfolder can't fit on a single per-recipe template, so each
 * location gets its own template + standard-values.
 *
 * Keyed by `(site, recipeHandle, subfolder)` to keep it distinct from
 * the per-recipe `siteDataFolderTemplateId` (single uniform Insert
 * Options) and the cross-recipe `sharedDataFolderTemplateId` (coalesces
 * multiple recipes' contributions to one subfolder).
 */
export const siteDataFolderTemplateIdForLocation = (
  site: string,
  recipeHandle: string,
  subfolder: string
): string =>
  uuidv5(`${site}::${recipeHandle}::${subfolder}::data-folder-template`, NAMESPACE_TEMPLATE);

export const siteDataFolderStandardValuesIdForLocation = (
  site: string,
  recipeHandle: string,
  subfolder: string
): string =>
  uuidv5("__standard-values", siteDataFolderTemplateIdForLocation(site, recipeHandle, subfolder));

/**
 * SHARED Data Folder template — keyed on `(site, subfolder)` instead of
 * `(site, recipeHandle)`. Emitted by `compileRecipeSet` when two or
 * more recipes target the same site-scoped `subfolder` (the shared-
 * pool design-system pattern: Badge + StatusPill + Tag all populating
 * `Site Shared UI/Badges`). The shared template's `__Standard Values`
 * Insert Options field aggregates every contributing recipe's
 * datasource template, so a CMS author right-clicking → Insert sees
 * all the shapes that legitimately belong in that pool.
 *
 * Per-recipe `siteDataFolderTemplateId` stays in use for the
 * SINGLETON case (one recipe → one subfolder). The choice between the
 * two is made by the cross-recipe coalescer in `compileRecipeSet`:
 * count refs per `(site, subfolder)`; ≥2 → shared template;
 * exactly 1 → per-recipe template.
 */
export const sharedDataFolderTemplateId = (site: string, subfolder: string): string =>
  uuidv5(`${site}::shared-data-folder-template::${subfolder}`, NAMESPACE_TEMPLATE);

/**
 * Identity helpers for `SiteTemplateRecipe`-emitted artifacts.
 *
 * The site template's own item identity is `templateId(site, handle)` —
 * a site template is a Sitecore template item, same identity family as
 * regular templates. The helpers below derive companion items the
 * site-template compile emits alongside it: media uploads (thumbnail /
 * image), the tenant-rooted SXA Module root, and each setup-action
 * child under the Module root. All seeds scope under the site
 * template's own GUID so two recipes with the same handle in different
 * sites don't collide.
 */

/**
 * Recipe-internal refKey for a thumbnail media item emitted by
 * `MediaUploadOp` when a `SiteTemplateRecipe` populates `thumbnail`.
 * Pairs 1:1 with the SetField op that writes the `__Thumbnail` media
 * XML on the site template item — the SetField value's
 * `kind: "media-xml-ref"` references this same refKey, which the
 * executor substitutes at apply time for the captured media itemId.
 */
export const thumbnailMediaId = (site: string, handle: string): string =>
  uuidv5("thumbnail", templateId(site, handle));

/**
 * Recipe-internal refKey for an image (hero) media item emitted when a
 * `SiteTemplateRecipe` populates `image`. Distinct seed from
 * `thumbnailMediaId` so a recipe that supplies both gets two upload
 * ops — even though Sub-milestone A's U3 finding suggests the picker
 * surfaces the same media item for both. Schema-level intent is
 * preserved; collapsing into one upload is a follow-up if U3's
 * observation holds against a live Sites API run.
 */
export const imageMediaId = (site: string, handle: string): string =>
  uuidv5("image", templateId(site, handle));

/**
 * Recipe-internal refKey for the tenant-rooted SXA Module item
 * synthesised by `compileSiteTemplateRecipe`. Conforms to
 * `HEADLESS_SITE_SETUP_ROOT`; lands at
 * `<siteTemplatesRoot>/Modules/<RecipeName>`. The site template's
 * `Site Modules` field aggregates this refKey alongside the hardcoded
 * `FOUNDATION_SITE_MODULES` GUIDs.
 */
export const siteTemplateModuleId = (site: string, handle: string): string =>
  uuidv5("module", templateId(site, handle));

/**
 * Recipe-internal refKey for one setup-action child item under a
 * recipe-synthesised SXA Module root. Each `pageTemplates[i]`,
 * `pageDesigns[i]`, `insertOptionsMatrix[k]`, etc. expands to a
 * separate action-child item; the seed encodes both the action
 * "kind" (which the compiler picks per source field) and the
 * referenced handle so two pageTemplates entries get distinct refKeys.
 */
export const siteTemplateModuleActionId = (
  site: string,
  handle: string,
  actionKind: string,
  targetHandle: string
): string => uuidv5(`${actionKind}::${targetHandle}`, siteTemplateModuleId(site, handle));

/**
 * Standard-values item refKey for a shared per-subfolder Data Folder
 * template. Same `__standard-values` seed pattern as the rest of the
 * SV family.
 */
export const sharedDataFolderStandardValuesId = (site: string, subfolder: string): string =>
  uuidv5("__standard-values", sharedDataFolderTemplateId(site, subfolder));

/**
 * Recipe-internal refKey for the site Data folder ROOT's
 * `__Standard Values` item (one per site). The ITEM at
 * `<contentItemsRoot>` itself is tenant-pre-existing or
 * lazy-created; scai writes the SV directly under it via a
 * CreateOnly CreateItem op.
 */
export const siteDataRootStandardValuesId = (site: string): string =>
  uuidv5(`${site}::data-root-standard-values`, NAMESPACE_PROJECT);

/**
 * Recipe-internal refKey for the enumerations root ITEM (one per site
 * — the `<enumerationsRoot>` content tree node, e.g.
 * `<site>/Presentation/Enumerations`). The path-walker would otherwise
 * auto-create this as the generic `Folder` template with the default
 * folder icon when child ops first land; scai emits an explicit
 * CreateAndUpdate CreateItem against this refKey so the item exists
 * with the enumeration glyph icon, matching the per-site enumeration
 * templates' icon.
 */
export const enumerationsRootId = (site: string): string =>
  uuidv5(`${site}::enumerations-root`, NAMESPACE_PROJECT);

/**
 * Recipe-internal refKey for the enumerations root's
 * `__Standard Values` item (one per site). Mirror of
 * `siteDataRootStandardValuesId` for the enumerations tree — scai
 * writes the SV directly under the root via a CreateOnly CreateItem op
 * so authors' right-click → Insert UX is restricted to enumeration
 * folders + the generic Folder template.
 */
export const enumerationsRootStandardValuesId = (site: string): string =>
  uuidv5(`${site}::enumerations-root-standard-values`, NAMESPACE_PROJECT);

/**
 * Per-site `__Standard Values` item under the `Enumerations Folder`
 * template definition (NOT under each data folder). Linked to the
 * template via `SetStandardValues` so its `Insert Options` propagates
 * to every item conforming to Enumerations Folder — both the
 * grouping-folder items under `<enumerationsRoot>` and the per-enum
 * data folders themselves get the same Insert UX without an SV item
 * polluting each data folder's children.
 *
 * Replaces the old `enumerationFolderStandardValuesId` (per-recipe SV
 * under each data folder), which was non-functional anyway — it set
 * Insert Options on the SV item without `SetStandardValues` linking,
 * so the field had no effect, but the SV item itself appeared in the
 * Droplink picker as a sibling of the enum value items.
 */
export const enumerationsFolderTemplateStandardValuesId = (site: string): string =>
  uuidv5(`${site}::enumerations-folder-template-standard-values`, NAMESPACE_TEMPLATE);

/**
 * Placeholder Settings item identity.
 *
 * A Placeholder Settings item is the gate for "what renderings can be
 * dropped into this slot" — it carries a `Placeholder Key` and an
 * `Allowed Controls` whitelist. Its identity is the **placeholder key**,
 * not a recipe handle: one key = one settings item. A standalone
 * `PlaceholderRecipe` and an inline `ComponentTemplateRecipe.placeholders`
 * entry that name the same key therefore derive the *same* GUID — which
 * is correct (they describe the same Sitecore item) and lets the
 * cross-recipe validator flag the ambiguous double-declaration.
 *
 * Site-scoped like the rest of the per-Project item family, so the same
 * recipe set pushed to two sites yields two distinct Placeholder
 * Settings items under each site's Presentation tree.
 */
export const NAMESPACE_PLACEHOLDER = uuidv5("placeholder", NAMESPACE_ROOT);

export const placeholderSettingsId = (site: string, key: string): string =>
  uuidv5(`${site}::${key}`, NAMESPACE_PLACEHOLDER);

/**
 * Deterministic refKey for one segment of a placeholder `folder`
 * grouping path under `<placeholderSettingsRoot>/<…segments…>`. Conforms
 * to the SXA `Placeholder Settings Folder` template. Site-scoped + keyed
 * on the segment's CUMULATIVE path so two recipes naming the same folder
 * (`"Partial Design/Header"`) reuse the `Partial Design` and
 * `Partial Design/Header` folders rather than colliding — pass the
 * cumulative path, not the leaf segment.
 *
 * Same `NAMESPACE_PROJECT` "site organisational folder" family as
 * section folders and the enumeration grouping folders.
 */
export const placeholderSettingsFolderId = (site: string, cumulativePath: string): string =>
  uuidv5(`${site}:Placeholder Settings:${cumulativePath}`, NAMESPACE_PROJECT);

/**
 * Deterministic refKey for a system template referenced by content-tree
 * path (workflow/webhook/etc. system templates whose GUIDs aren't
 * published). Same identity for the same path forever — the push
 * pipeline seeds `crossRecipeRefs[<this refKey>] = path`; the executor
 * batches a single `getItemsByPaths` lookup and the planner resolves
 * `templateOf: ref-path` ops through the existing `capturedItemIds`
 * map.
 */
export const NAMESPACE_TEMPLATE_BY_PATH = uuidv5("template-by-path", NAMESPACE_ROOT);
export const templatePathRefKey = (path: string): string =>
  uuidv5(path, NAMESPACE_TEMPLATE_BY_PATH);

/**
 * Deterministic refKey for the `__Standard Values` item under a
 * tenant-existing template referenced by content-tree path. Used by
 * `WorkflowRecipe.bindings.templates` entries that point at an absolute
 * template path (not an intra-recipe handle): the compiler emits a
 * `SetField` op with `latePath: "<templatePath>/__Standard Values"`,
 * and the executor's late-path resolution walks the path to seed the
 * captured-itemId map before planning the field write. Same identity
 * for the same path forever.
 */
export const NAMESPACE_STANDARD_VALUES_BY_PATH = uuidv5("standard-values-by-path", NAMESPACE_ROOT);
export const standardValuesPathRefKey = (templatePath: string): string =>
  uuidv5(templatePath, NAMESPACE_STANDARD_VALUES_BY_PATH);

/**
 * Workflow recipe identities.
 *
 * Workflows live at `/sitecore/system/Workflows/[<group>/]<name>` and
 * are tenant-wide (not site-scoped), so GUIDs derive from the recipe
 * handle directly. Sub-items (states, commands, actions) nest under
 * the workflow's GUID to keep the hierarchy stable across renames at
 * deeper levels.
 */
export const NAMESPACE_WORKFLOW = uuidv5("workflow", NAMESPACE_ROOT);
export const workflowId = (handle: string): string => uuidv5(handle, NAMESPACE_WORKFLOW);
export const workflowStateId = (handle: string, stateKey: string): string =>
  uuidv5(`state:${stateKey}`, workflowId(handle));
export const workflowCommandId = (handle: string, stateKey: string, commandKey: string): string =>
  uuidv5(`command:${commandKey}`, workflowStateId(handle, stateKey));
/** Webhook submit/validation action under a workflow STATE's `Actions` folder. */
export const workflowStateActionId = (handle: string, stateKey: string, index: number): string =>
  uuidv5(`action:${index}`, workflowStateId(handle, stateKey));
/** Webhook validation action under a workflow COMMAND's `Actions` folder. */
export const workflowCommandValidationId = (
  handle: string,
  stateKey: string,
  commandKey: string,
  index: number
): string => uuidv5(`validation:${index}`, workflowCommandId(handle, stateKey, commandKey));
/** Workflow group folder under /sitecore/system/Workflows (when meta.tax.group is set). */
export const workflowGroupFolderId = (group: string): string =>
  uuidv5(`group:${group}`, NAMESPACE_WORKFLOW);

/**
 * Webhook Authorization recipe identity. Items live at
 * `/sitecore/system/Settings/Webhooks/Authorizations/<name>` — flat,
 * tenant-wide. Used by workflow webhook actions + event handlers to
 * carry credentials.
 */
export const NAMESPACE_WEBHOOK_AUTHORIZATION = uuidv5("webhook-authorization", NAMESPACE_ROOT);
export const webhookAuthorizationId = (handle: string): string =>
  uuidv5(handle, NAMESPACE_WEBHOOK_AUTHORIZATION);
