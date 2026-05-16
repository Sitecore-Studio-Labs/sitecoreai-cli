import type { PartialDesignRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Showcase set — the standard header partial. One CTA placement in the
 * `/header` placeholder; `showcase-design@1` composes this partial.
 */
export const showcaseHeaderRecipe = {
  kind: "partial-design",
  schemaVersion: "1",
  handle: "showcase-header@1",
  name: "ShowcaseHeader",
  displayName: "Showcase Header",
  description: "Reusable header partial with a single call-to-action.",
  layout: {
    placeholders: {
      "/header": [{ componentHandle: "showcase-cta@1", datasourceRef: { kind: "none" } }],
    },
  },
} satisfies PartialDesignRecipe;
