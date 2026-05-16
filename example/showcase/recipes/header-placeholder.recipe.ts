import type { PlaceholderRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Showcase set — the header slot. Standalone `PlaceholderRecipe` nested
 * under a `Partial Designs` grouping folder; the `showcase-header@1`
 * partial places renderings into it.
 */
export const showcaseHeaderPlaceholderRecipe = {
  kind: "placeholder",
  schemaVersion: "1",
  handle: "showcase-header-slot@1",
  key: "/header",
  name: "Header",
  displayName: "Header",
  description: "The site header slot, filled by the standard header partial.",
  folder: "Partial Designs",
  allowedComponents: ["showcase-cta@1"],
} satisfies PlaceholderRecipe;
