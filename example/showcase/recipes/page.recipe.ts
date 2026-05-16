import type { PageTemplateRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Showcase set — the page template. Inherits the SXA Headless page
 * base set; `showcase-design@1` targets it via `appliesTo`.
 */
export const showcasePageRecipe = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "showcase-page@1",
  name: "ShowcasePage",
  displayName: "Showcase Page",
  description: "A content page — the showcase set's authorable page type.",
  fields: [
    {
      name: "MetaTitle",
      shape: "text",
      sitecore: { hint: "Overrides the <title> tag.", section: "SEO" },
    },
  ],
} satisfies PageTemplateRecipe;
