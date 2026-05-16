import type { PlaceholderRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Showcase set — the main page-body placeholder. Standalone
 * `PlaceholderRecipe` (site-chrome half of the hybrid model). Nested
 * under a `Page Designs` grouping folder; its `Allowed Controls`
 * whitelist is the union of `allowedComponents` here and any component
 * naming `headless-main` in `placedIn` (both CTA and Rich Text do).
 */
export const showcaseMainPlaceholderRecipe = {
  kind: "placeholder",
  schemaVersion: "1",
  handle: "showcase-main@1",
  key: "headless-main",
  name: "Main",
  displayName: "Page Body",
  description: "The primary content placeholder for showcase pages.",
  folder: "Page Designs",
  allowedComponents: ["showcase-cta@1", "showcase-rich-text@1"],
} satisfies PlaceholderRecipe;
