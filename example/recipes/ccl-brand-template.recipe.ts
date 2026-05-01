import type { SiteTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Worked example — Click-Click-Launch brand template.
 *
 * A reusable site template defining the brand's structural shape:
 * the page templates it offers, the page designs it ships, the
 * insert-options matrix that constrains the content tree, the
 * default templates-to-designs mapping, and the dictionary +
 * taxonomy structure each instance starts with.
 *
 * Many `SiteRecipe`s instance one `SiteTemplateRecipe`. The
 * `solterra-co.recipe.ts` and `alaris.recipe.ts` fixtures both
 * point at THIS template — that's the multi-brand demo pattern.
 *
 * Cross-recipe references:
 *   - `pageTemplates`, `insertOptionsMatrix.*` resolve to
 *     `ContentTemplateRecipe` handles
 *   - `pageDesigns`, `templatesToDesigns.*` values resolve to
 *     `PageDesignRecipe` handles already shipped in this catalog
 *     (`default-page-design@1`, `landing-design@1`, `article-design@1`)
 */
export const cclBrandTemplateRecipe = {
  kind: "site-template",
  schemaVersion: "1",
  handle: "ccl-brand-template@1",
  name: "ClickClickLaunchBrand",
  displayName: "Click Click Launch Brand Template",
  description:
    "Reusable brand template — page templates, designs, insert options, dictionary + taxonomy structure. Many sites can instance this template.",

  pageTemplates: [
    "home-page@1",
    "article-page@1",
    "landing-page@1",
    "product-page@1",
    "page-folder@1",
  ],

  insertOptionsMatrix: {
    "home-page@1": ["article-page@1", "landing-page@1", "product-page@1", "page-folder@1"],
    "article-page@1": ["article-page@1", "page-folder@1"],
    "landing-page@1": ["article-page@1", "page-folder@1"],
    "product-page@1": ["product-page@1", "page-folder@1"],
    "page-folder@1": ["article-page@1", "landing-page@1", "product-page@1", "page-folder@1"],
  },

  pageDesigns: ["default-page-design@1", "landing-design@1", "article-design@1"],

  templatesToDesigns: {
    "home-page@1": "default-page-design@1",
    "article-page@1": "article-design@1",
    "landing-page@1": "landing-design@1",
    "product-page@1": "default-page-design@1",
  },

  dictionary: [
    { phrase: "ContactUs", defaultValue: "Contact Us" },
    { phrase: "ReadMore", defaultValue: "Read more" },
    { phrase: "BackToTop", defaultValue: "Back to top" },
    { phrase: "Loading", defaultValue: "Loading…" },
    { phrase: "SearchPlaceholder", defaultValue: "Search…" },
    { phrase: "Submit", defaultValue: "Submit" },
  ],

  taxonomy: [
    {
      root: "Content Types",
      defaultTags: ["Article", "Product", "Landing"],
    },
    {
      root: "Topics",
      defaultTags: ["Announcements", "Engineering", "Design", "Operations"],
    },
  ],
} satisfies SiteTemplateRecipe;
