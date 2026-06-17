import { z } from "zod";
import {
  ContentFieldValueSchema,
  ContentTranslationSchema,
  ContentVersionSchema,
  LayoutSchema,
} from "../content-values";
import { FieldDefinitionSchema, HANDLE_PATTERN, RecipeMetaSchema } from "../shared";

/**
 * A page template — a Sitecore data template that items in a site's
 * content tree conform to in order to BE authorable pages. The
 * page-level peer of `ComponentTemplateRecipe`: where a component
 * template backs a placeable rendering, a page template backs a
 * navigable page.
 *
 * Unlike `ContentTemplateRecipe` (a plain data shape), a page template
 * inherits the SXA Headless page base set (`SXA_HEADLESS_PAGE_BASE_TEMPLATES`
 * — Base Page + _Navigable + _Taggable + _Designable + _Sitemap) so
 * items conforming to it pick up the layout/presentation fields, the
 * navigation facet, taxonomy tagging, the page-design binding, and
 * sitemap metadata. The compiler also stamps the template's
 * `__Standard Values` `__Renderings` with a JSON-layout shell
 * (`<r><d id="{device}" l="{jsonLayout}" /></r>`), optionally seeded
 * with `layout` placements.
 *
 * Page templates are the resolution target for `PageDesignRecipe.appliesTo`,
 * `SiteTemplateRecipe.pageTemplates`, `insertOptionsMatrix`, and
 * `templatesToDesigns` keys. The default template→design binding is the
 * `TemplatesMapping` aggregate on the Page Designs root (driven by
 * `PageDesignRecipe.appliesTo`); the per-page `Page Design` override
 * field is left unset.
 *
 * Identity: `templateId(site, handle)` — a page template IS a Sitecore
 * template, same GUID family as component/content templates.
 */
export const PageTemplateRecipeSchema = z.object({
  kind: z.literal("page-template"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. article-page@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /** Defaults to the SXA page icon if omitted. */
  icon: z.string().optional(),
  /**
   * Optional taxonomy metadata. `meta.tax.group` nests the template one
   * folder level deep: when set, the template lands at
   * `<pageTemplatesRoot>/<group>/<name>` (the group folder is emitted
   * once per recipe set as a `CreateOnly` op) instead of flat under
   * `<pageTemplatesRoot>/<name>`. Other taxonomy fields pass through
   * unmodified for downstream consumers.
   */
  meta: RecipeMetaSchema,
  /**
   * Page-specific fields beyond the inherited SXA base — SEO copy,
   * hero overrides, structured metadata. Grouped into sections the
   * same way component/content template fields are.
   */
  fields: z.array(FieldDefinitionSchema).default([]),
  /**
   * Page-template handles allowed as child pages under items of this
   * template — the Sitecore Insert Options surface for content authors.
   * Resolve to other `PageTemplateRecipe` handles.
   */
  insertOptions: z.array(z.string().regex(HANDLE_PATTERN)).optional(),
  /**
   * Optional default presentation baked into the template's
   * `__Standard Values` layout. Most page templates leave this empty —
   * page chrome comes from the page design's partials, and page-local
   * content lands on the page item's own `__Final Renderings`. Set it
   * only for renderings every page of this template should carry
   * regardless of design.
   */
  layout: LayoutSchema.optional(),
  /**
   * Optional `WorkflowRecipe` handle bound on the template's
   * `__Standard Values` `__Default workflow` — new pages of this
   * template enter the workflow automatically. Mirrors
   * `ContentTemplateRecipe.defaultWorkflow`.
   */
  defaultWorkflow: z.string().regex(HANDLE_PATTERN).optional(),
});

export type PageTemplateRecipe = z.infer<typeof PageTemplateRecipeSchema>;

/**
 * A page — a concrete, navigable item in the site content tree. The
 * page-level peer of `ContentItemRecipe`: where a content item is a
 * shared datasource shape, a `PageRecipe` is an authorable page.
 *
 * It conforms to a `PageTemplateRecipe` (inheriting the SXA page
 * presentation facets), carries field values for the page's own
 * fields, and may declare a `layout` — written to the page item's
 * `__Final Renderings` (the per-version final layout), distinct from a
 * page design's `__Renderings`.
 *
 * Layout placements bind via `datasourceRef`: `shared` (a
 * `ContentItemRecipe`), `scoped` (a page-local datasource item the
 * compiler materialises at `<page>/Data/<slot>`), or `none`. Pages
 * currently land flat under `pagesRoot` — page-tree nesting (a `parent`
 * page handle) is the one deferred follow-up.
 *
 * Identity: `pageItemId(site, handle)`. `SiteRecipe.initialHome`
 * resolves to a `PageRecipe` handle.
 */
export const PageRecipeSchema = z.object({
  kind: z.literal("page"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. home@1",
  }),
  /** Sitecore item name under the pages root. */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /**
   * Handle of the `PageTemplateRecipe` this page conforms to. Compiler
   * resolves via `templateId(handle)` to set the item's Template-Of.
   */
  template: z.string().regex(HANDLE_PATTERN, {
    message: "template must reference a PageTemplateRecipe by handle, e.g. article-page@1",
  }),
  /**
   * Explicit item path in the content tree. Must start with the literal
   * prefix `/sitecore/content/{site}/` — the `{site}` placeholder is the
   * only supported substitution and is replaced with the active site
   * name (`context.site`, defaulting to `default`) at compile time, so
   * the same recipe installs cleanly across sites. The path's parent
   * directory becomes the page's parent ref; the leaf segment supersedes
   * `name` for path emission.
   *
   * Optional for back-compat: when omitted, the compiler falls back to
   * `joinPath(context.pagesRoot, name)` (legacy behavior — `pagesRoot`
   * remains required only in that fallback path).
   *
   * Example: `/sitecore/content/{site}/Home/Homepage Demo`.
   */
  itemPath: z
    .string()
    .regex(/^\/sitecore\/content\/\{site\}\/.+/, {
      message:
        "itemPath must start with `/sitecore/content/{site}/` — `{site}` is the only supported placeholder and is substituted with the target site name at install time.",
    })
    .optional(),
  /**
   * Field values keyed by field name on the page template — the primary
   * language, single version. Simple-mode common case; mutually exclusive
   * with `versions` (story mode).
   *
   * Accepts BOTH shapes:
   *  - scai-native discriminated `ContentFieldValue` — `{ shape, value, ... }`.
   *  - Registry flat shape — plain strings (text), booleans, numbers,
   *    `{ src, alt }` for image fields, `{ href, text }` for link-external
   *    fields.
   *
   * `compilePageRecipe` normalises into `ContentFieldValue` then reuses
   * `encodeContentFieldValue` to emit the Sitecore wire form.
   */
  fields: z.record(z.string(), z.unknown()).default({}),
  /**
   * Simple mode — additional languages, one version each, keyed by ISO
   * language code (`fr`, `de`, …). Mirrors `ContentItemRecipe.translations`:
   * each translation carries the page's per-language field values.
   * Mutually exclusive with `versions`.
   *
   * For per-language layout, use story mode (`versions[lang][n].layout`) —
   * simple mode reuses the item-level `layout` across every language.
   */
  translations: z.record(z.string(), ContentTranslationSchema).optional(),
  /**
   * Story mode — explicit numbered versions per language, ordered, each
   * an array of `ContentVersion`s (fields + optional per-version layout,
   * date, workflowState). Mirrors `ContentItemRecipe.versions`. Mutually
   * exclusive with `fields` / `translations` — a recipe is simple OR a
   * story. The compiler enforces the XOR.
   *
   * Per-version `layout` overrides the item-level `layout` for that
   * (language, version) cell.
   */
  versions: z.record(z.string(), z.array(ContentVersionSchema)).optional(),
  /**
   * Item-level `storage: shared` field values — one value for the whole
   * page, no language or version. Mirrors `ContentItemRecipe.shared`.
   */
  shared: z.record(z.string(), ContentFieldValueSchema).optional(),
  /**
   * Optional page-local presentation, written to the page item's
   * `__Final Renderings`. Placements use `datasourceRef` `shared`
   * (a `ContentItemRecipe`), `scoped` (a page-local datasource at
   * `<page>/Data/<slot>`, materialised by the compiler), or `none`.
   *
   * In simple mode this writes the default-language v1 layout (and
   * defaults every translation's layout to the same). In story mode the
   * item-level `layout` is forbidden — per-version `layout` is the
   * only place layout can live.
   */
  layout: LayoutSchema.optional(),
  /**
   * Optional `WorkflowRecipe` handle — sets the page item's
   * `__Workflow` field. Mirrors `ContentItemRecipe.workflow`.
   */
  workflow: z.string().regex(HANDLE_PATTERN).optional(),
});

export type PageRecipe = z.infer<typeof PageRecipeSchema>;
