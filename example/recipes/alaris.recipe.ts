import type { SiteRecipe } from "../../src/recipe/schema/recipe";

/**
 * Worked example — Alaris, a SECOND brand instance of
 * `ccl-brand-template@1`.
 *
 * Same template as `solterra-co@1`, different brand identity:
 *  - References an EXISTING collection by ID (vs Solterra creating
 *    a new one). Shows both collection-binding shapes against one
 *    template.
 *  - Different hostname
 *  - Different dictionary override surface (overrides `ReadMore`
 *    instead of `ContactUs`)
 *  - No taxonomy overrides — uses the template defaults
 *
 * Together with `solterra-co.recipe.ts`, this proves the
 * SiteTemplate / SiteRecipe split works for multi-brand demos:
 * one template + N sites, each with its own identity but a shared
 * structural shape.
 *
 * The collection ID below is illustrative — recipe pushes against
 * a real tenant would replace it with a value from
 * `listCollections()`.
 */
export const alarisRecipe = {
  kind: "site",
  schemaVersion: "1",
  handle: "alaris@1",
  name: "Alaris",
  displayName: "Alaris",
  description: "Alaris brand site — minimalist, English.",

  siteTemplate: "ccl-brand-template@1",
  language: "en",

  // Existing collection — replace with a real ID from listCollections()
  // when pushing against a tenant. Set up to belong to the same
  // collection Solterra creates, so multi-brand portfolio sites can
  // be grouped under one collection.
  collectionId: "5aae1eeaea2440bf96f11f43da82c77b",

  siteGrouping: {
    hostName: "alaris.example.com",
    language: "en",
  },

  dictionaryOverrides: {
    ReadMore: "Continue reading",
  },
} satisfies SiteRecipe;
