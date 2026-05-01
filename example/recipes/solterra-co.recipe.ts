import type { SiteRecipe } from "../../src/recipe/schema/recipe";

/**
 * Worked example — Solterra & Co, a brand instance of
 * `ccl-brand-template@1`.
 *
 * Demonstrates the multi-brand SiteRecipe pattern:
 *  - References the brand template by handle (`siteTemplate`)
 *  - Creates a NEW collection alongside the site (`collectionName`)
 *  - Sets a brand-specific hostname via `siteGrouping`
 *  - Overrides one dictionary phrase ("Contact Us" → "Get in touch
 *    with Solterra")
 *  - Adds a brand-specific taxonomy tag (`Audio`) on the
 *    `Content Types` root
 *
 * Companion fixture `alaris.recipe.ts` instances the SAME template
 * with different overrides — together they prove a single template
 * can serve multiple brands cleanly.
 */
export const solterraCoRecipe = {
  kind: "site",
  schemaVersion: "1",
  handle: "solterra-co@1",
  name: "SolterraCo",
  displayName: "Solterra & Co",
  description: "Solterra brand site — sustainable design, English.",

  siteTemplate: "ccl-brand-template@1",
  language: "en",

  collectionName: "Click Click Launch",
  collectionDisplayName: "Click Click Launch",
  collectionDescription: "Brand collection for the Click-Click-Launch portfolio.",

  siteGrouping: {
    hostName: "solterra.example.com",
    language: "en",
  },

  dictionaryOverrides: {
    ContactUs: "Get in touch with Solterra",
  },

  taxonomyOverrides: {
    "Content Types": ["Article", "Product", "Landing", "Audio"],
  },
} satisfies SiteRecipe;
