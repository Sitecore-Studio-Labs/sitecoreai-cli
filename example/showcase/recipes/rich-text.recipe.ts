import type { ComponentTemplateRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Showcase set — a rich-text block. Page-body content, placeable into
 * the `headless-main` placeholder.
 */
export const showcaseRichTextRecipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "showcase-rich-text@1",
  name: "ShowcaseRichText",
  displayName: "Showcase Rich Text",
  description: "A rich-text content block.",
  fields: [{ name: "Body", shape: "richText" }],
  variants: [{ name: "Default" }],
  params: [],
  placedIn: ["headless-main"],
  placeholders: [],
  dynamicPlaceholders: false,
} satisfies ComponentTemplateRecipe;
