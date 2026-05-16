import type { PageTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Worked example — the site Home page template.
 *
 * The minimal `PageTemplateRecipe` shape: no extra fields beyond the
 * inherited SXA page base set, just `insertOptions` declaring which
 * page types an author may create beneath the home page.
 *
 * `default-page-design@1` targets this template via `appliesTo`, and
 * `ccl-brand-template@1` lists it in `pageTemplates` as the brand's
 * home page type.
 */
export const homePageRecipe = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "home-page@1",
  name: "HomePage",
  displayName: "Home Page",
  description: "Site landing / home page — the root of the content tree.",

  // Authors can create article pages directly under Home.
  insertOptions: ["article-page@1"],
} satisfies PageTemplateRecipe;
