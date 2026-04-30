import type { PageDesignRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 4 worked example — full-bleed landing design. Skips the header
 * (landings often drop nav for conversion focus) and adds a CTA pinned
 * to the design itself, not the individual page.
 *
 * Demonstrates a page design with:
 *   - Just one partial (footer only — no header)
 *   - One page-template applies-to handle (landing-page@1)
 *   - Own layout: a `cta-banner@1` rendering placed at the design level,
 *     so every landing using this design gets the same banner
 *     regardless of which page is using the design
 */
export const landingDesignRecipe = {
  kind: "page-design",
  schemaVersion: "1",
  handle: "landing-design@1",
  name: "LandingDesign",
  displayName: "Landing Page Design",
  description: "Full-bleed landing — footer only, with a design-level CTA banner.",

  appliesTo: ["landing-page@1"],
  partials: ["standard-footer@1"],

  layout: {
    placeholders: {
      "/page-design-cta": [
        {
          componentHandle: "cta-banner@1",
          variant: "default",
          datasourceRef: { kind: "shared", handle: "landing-cta-content@1" },
        },
      ],
    },
  },
} satisfies PageDesignRecipe;
