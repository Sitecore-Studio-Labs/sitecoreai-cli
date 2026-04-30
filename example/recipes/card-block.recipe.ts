import type { ComponentTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Recipe for the `CardBlock` component (./card-block.tsx).
 *
 * Bucket choices for card-block:
 *
 *   fields    Content surface — title, description, body, and image.
 *             `Description` overrides the default `text`-shape mapping
 *             to `multi-line-text` for multi-paragraph plain text without
 *             rich-text formatting; `Content` uses `richText` for the
 *             card body.
 *
 *   variants  `flat | outline | filled` — the structural CVA axis (the
 *             card primitive's `style` prop). Each becomes a Variant
 *             item under <CardBlock>/Variants.
 *
 *   params    `Elevation`, `Padding` — orthogonal CVA modifiers.
 *
 * Phase 1 scope: skips the `actions` and `footer` slots, which are
 * placeholder-shaped and best modeled with placeholder definitions +
 * layout XML once the IR supports them (Phase 4+). For now, those slots
 * stay React-only.
 */
export const cardBlockRecipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "card-block@1",
  name: "CardBlock",
  displayName: "Card",
  description:
    "Composable card with media, title, description, and body. Three structural variants and orthogonal elevation/padding modifiers.",

  fields: [
    {
      name: "Title",
      shape: "text",
      sitecore: {
        type: "single-line-text",
        hint: "Card heading.",
        section: "Content",
        sortOrder: 100,
      },
    },
    {
      name: "Description",
      shape: "text",
      sitecore: {
        type: "multi-line-text",
        hint: "Short subhead. Plain text, no formatting.",
        section: "Content",
        sortOrder: 200,
      },
    },
    {
      name: "Content",
      shape: "richText",
      sitecore: {
        hint: "Card body. Supports rich-text formatting.",
        section: "Content",
        sortOrder: 300,
      },
    },
    {
      name: "Media",
      shape: "image",
      sitecore: {
        hint: "Image displayed above the header.",
        section: "Media",
        sortOrder: 100,
      },
    },
  ],

  variants: [{ name: "flat" }, { name: "outline" }, { name: "filled" }],

  params: [
    {
      name: "Elevation",
      shape: "enum",
      values: ["theme", "none", "xs", "sm", "base", "md", "lg"],
      default: "theme",
      sitecore: {
        type: "droplist",
        hint: "Shadow depth. `theme` defers to the active theme.",
        sortOrder: 100,
      },
    },
    {
      name: "Padding",
      shape: "enum",
      values: ["sm", "md", "lg"],
      default: "lg",
      sitecore: {
        type: "droplist",
        hint: "Inner padding density.",
        sortOrder: 200,
      },
    },
  ],

  rendering: {
    /**
     * Convention: card datasources live in the site's Data folder.
     * Tenants with a different content layout may need a per-install override.
     */
    datasourceLocation: "query",
    datasourceLocationQuery: "query:$site/*[@@name='Data']",
    openPropertiesAfterAdd: false,
    otherProperties: {
      IsAutoDatasourceRendering: "true",
    },
  },
} satisfies ComponentTemplateRecipe;

export default cardBlockRecipe;
