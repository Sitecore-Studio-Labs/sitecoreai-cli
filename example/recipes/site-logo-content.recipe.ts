import type { ContentItemRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 4 worked example — a shared content item. Referenced from
 * `standard-header@1`'s `site-logo@1` placement via
 * `datasourceRef: { kind: "shared", handle: "site-logo-content@1" }`.
 *
 * Demonstrates the simplest ContentItemRecipe shape: a few text/image
 * field values populating one item that conforms to a content template.
 *
 * The `templateType` handle (`site-logo-template@1`) is referenced
 * symbolically here — the actual ContentTemplateRecipe defining it
 * doesn't ship in this PR. Phase 4's compiler will validate cross-recipe
 * existence at compile time; the schema only validates handle pattern
 * here.
 */
export const siteLogoContentRecipe = {
  kind: "content-item",
  schemaVersion: "1",
  handle: "site-logo-content@1",
  name: "SiteLogoContent",
  displayName: "Site Logo (default)",
  description: "Default site logo content used by the standard-header partial.",

  templateType: "site-logo-template@1",

  fields: {
    Image: {
      shape: "image",
      mediaPath: "/sitecore/media-library/Project/site-logo",
      alt: "Site logo",
      width: 160,
      height: 32,
    },
    Tagline: {
      shape: "text",
      value: "Welcome to the showcase",
    },
    HomeLink: {
      shape: "link-internal",
      ref: "home-page@1",
      text: "Home",
    },
  },
} satisfies ContentItemRecipe;
