import type { ContentTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Content template for an accordion item. No rendering — accordion-items
 * exist only as content referenced by `accordion-block@1` (either via
 * its `Items` Treelist field or as Sitecore children of its datasource;
 * see `accordion-block.recipe.ts`).
 *
 * Five fields, all optional except Title. Mirrors `AccordionItemFields`
 * in `../accordion-block.tsx`.
 */
export const accordionItemRecipe = {
  kind: "content-template",
  schemaVersion: "1",
  handle: "accordion-item@1",
  name: "AccordionItem",
  displayName: "Accordion Item",
  description:
    "One row of an accordion: collapsible title + content, with optional media variant fields.",

  fields: [
    {
      name: "Title",
      shape: "text",
      sitecore: {
        type: "single-line-text",
        required: true,
        hint: "The clickable header for this accordion row.",
        sortOrder: 100,
      },
    },
    {
      name: "Content",
      shape: "richText",
      sitecore: {
        hint: "The body shown when the accordion row is expanded.",
        sortOrder: 200,
      },
    },
    {
      name: "Description",
      shape: "text",
      sitecore: {
        type: "multi-line-text",
        hint: "Optional short summary used by the media variant. Plain text.",
        sortOrder: 300,
      },
    },
    {
      name: "Image",
      shape: "image",
      sitecore: {
        hint: "Optional thumbnail used by the media variant.",
        section: "Media",
        sortOrder: 100,
      },
    },
    {
      name: "Link",
      shape: "link",
      sitecore: {
        type: "general-link",
        hint: "Optional CTA link rendered in the expanded body.",
        section: "Media",
        sortOrder: 200,
      },
    },
  ],
} satisfies ContentTemplateRecipe;

export default accordionItemRecipe;
