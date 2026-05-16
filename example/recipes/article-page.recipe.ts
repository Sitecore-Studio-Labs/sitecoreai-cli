import type { PageTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Worked example — an Article page template.
 *
 * A `PageTemplateRecipe` compiles to a Sitecore data template that
 * inherits the SXA Headless page base set (Base Page + _Navigable +
 * _Taggable + _Designable + _Sitemap), so items conforming to it are
 * authorable pages in XM Cloud Pages — not plain data shapes. The
 * compiler also stamps the template's `__Standard Values` with a
 * JSON-layout shell so pages render through the headless pipeline.
 *
 * Demonstrates:
 *   - page-specific `fields` (SEO metadata) on top of the inherited base
 *   - `insertOptions` — an article page may contain child article pages
 *   - no `layout` — page chrome comes from `article-design@1`'s partials,
 *     and page-local content lands on each page item's own renderings
 *
 * `article-design@1` (a `PageDesignRecipe`) targets this template via
 * its `appliesTo`, and `ccl-brand-template@1` lists it in `pageTemplates`.
 */
export const articlePageRecipe = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "article-page@1",
  name: "ArticlePage",
  displayName: "Article Page",
  description: "Editorial article page — SEO metadata fields, content-focused design.",

  fields: [
    {
      name: "MetaTitle",
      shape: "text",
      sitecore: { hint: "Overrides the <title> tag; falls back to the page name.", section: "SEO" },
    },
    {
      name: "MetaDescription",
      shape: "text",
      sitecore: { hint: "The <meta name=description> value for search results.", section: "SEO" },
    },
    {
      name: "Eyebrow",
      shape: "text",
      sitecore: { hint: "Small uppercase label shown above the article title.", section: "Content" },
    },
  ],

  // An article page can hold child article pages (a series / sub-articles).
  insertOptions: ["article-page@1"],
} satisfies PageTemplateRecipe;
