import type { ComponentTemplateRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Showcase set — a call-to-action button. The interactive leaf
 * component, placeable into both the page body and the header.
 */
export const showcaseCtaRecipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "showcase-cta@1",
  name: "ShowcaseCta",
  displayName: "Showcase CTA",
  description: "A call-to-action button.",
  fields: [{ name: "Link", shape: "link", sitecore: { type: "general-link", required: true } }],
  variants: [{ name: "Default" }],
  params: [],
  // Recipe-defined placeholders this rendering may be dropped into —
  // resolved against `showcase-main@1` and `showcase-header-slot@1`.
  placedIn: ["headless-main", "/header"],
  placeholders: [],
  dynamicPlaceholders: false,
} satisfies ComponentTemplateRecipe;
