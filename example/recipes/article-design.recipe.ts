import type { PageDesignRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 4 worked example — content-focused article design. Three partials
 * in a specific render order, exercising the longest partials list of
 * the three page-design fixtures.
 *
 * Demonstrates a page design with:
 *   - Three partial-design references in render order [header, byline, footer]
 *   - One page-template applies-to handle (article-page@1)
 *   - No own layout — articles own their full content area at the page level
 */
export const articleDesignRecipe = {
  kind: "page-design",
  schemaVersion: "1",
  handle: "article-design@1",
  name: "ArticleDesign",
  displayName: "Article Design",
  description: "Content-focused article wrapper — header, byline meta, footer.",

  appliesTo: ["article-page@1"],
  partials: ["standard-header@1", "article-byline@1", "standard-footer@1"],
} satisfies PageDesignRecipe;
