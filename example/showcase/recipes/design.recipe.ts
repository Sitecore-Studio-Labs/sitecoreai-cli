import type { PageDesignRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Showcase set — the page design. Applies to `showcase-page@1`, wraps
 * content with the header partial, and seeds two design-level
 * placements in `headless-main` (CTA + Rich Text). Both placements are
 * validated against `showcase-main@1`'s Allowed Controls whitelist.
 */
export const showcaseDesignRecipe = {
  kind: "page-design",
  schemaVersion: "1",
  handle: "showcase-design@1",
  name: "ShowcaseDesign",
  displayName: "Showcase Design",
  description: "Header partial + a CTA and rich-text band in the page body.",
  appliesTo: ["showcase-page@1"],
  partials: ["showcase-header@1"],
  layout: {
    placeholders: {
      "headless-main": [
        { componentHandle: "showcase-rich-text@1", datasourceRef: { kind: "none" } },
        { componentHandle: "showcase-cta@1", datasourceRef: { kind: "none" } },
      ],
    },
  },
} satisfies PageDesignRecipe;
