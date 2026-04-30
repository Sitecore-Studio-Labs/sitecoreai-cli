import type { PageDesignRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 4 worked example — the "every other page uses this" generic
 * page design. Wraps content with the standard header and footer.
 *
 * Demonstrates a page design with:
 *   - Two partial-design references in render order [header, footer]
 *   - One page-template applies-to handle (the home page)
 *   - No own layout (the page itself owns its content placements)
 */
export const defaultPageDesignRecipe = {
  kind: "page-design",
  schemaVersion: "1",
  handle: "default-page-design@1",
  name: "DefaultPageDesign",
  displayName: "Default Page Design",
  description: "Generic wrapper page design — header + footer, no extra placements.",

  appliesTo: ["home-page@1"],
  partials: ["standard-header@1", "standard-footer@1"],
} satisfies PageDesignRecipe;
