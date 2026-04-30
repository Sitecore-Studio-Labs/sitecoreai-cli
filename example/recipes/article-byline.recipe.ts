import type { PartialDesignRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 4 worked example — a smaller, more specific partial used only by
 * `article-design@1`. Demonstrates a partial that's NOT linked into every
 * page design — only the article design picks it up.
 *
 * Three component placements in `/article-meta`:
 *
 *   author-avatar@1   no datasource (config-driven via params)
 *   author-info@1     datasource: scoped (page-local; the article's author info)
 *   read-time@1       no datasource
 *
 * Mixes `kind: "scoped"` (page-local content per article) with `kind: "none"`
 * (renderings whose configuration comes from rendering parameters only).
 * The `params` blob on the avatar exercises rendering-parameter pinning.
 */
export const articleBylineRecipe = {
  kind: "partial-design",
  schemaVersion: "1",
  handle: "article-byline@1",
  name: "ArticleByline",
  displayName: "Article Byline",
  description: "Author avatar, name, publish date, and read-time in one reusable partial.",

  layout: {
    placeholders: {
      "/article-meta": [
        {
          componentHandle: "author-avatar@1",
          params: { Size: "sm" },
          datasourceRef: { kind: "none" },
        },
        {
          componentHandle: "author-info@1",
          datasourceRef: { kind: "scoped", slot: "/article-meta/author" },
        },
        {
          componentHandle: "read-time@1",
          datasourceRef: { kind: "none" },
        },
      ],
    },
  },
} satisfies PartialDesignRecipe;
