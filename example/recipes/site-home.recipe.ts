import type { PageRecipe } from "../../src/recipe/schema/recipe";

/**
 * Worked example — the site's Home page.
 *
 * A `PageRecipe` is a concrete, navigable item in the site content
 * tree. The minimal shape: it conforms to a `PageTemplateRecipe`
 * (`home-page@1`), lands under the configured `pagesRoot`, and lets the
 * page design supply its chrome — so it declares no `layout` of its own.
 *
 * `SiteRecipe.initialHome` resolves to a `PageRecipe` handle like this
 * one.
 */
export const siteHomeRecipe = {
  kind: "page",
  schemaVersion: "1",
  handle: "site-home@1",
  name: "Home",
  displayName: "Home",
  description: "The site landing page — conforms to the home-page template.",
  template: "home-page@1",
} satisfies PageRecipe;
