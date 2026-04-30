import type { ComponentTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Recipe for the `BadgeBlock` component (./badge-block.tsx).
 *
 * Bucket choices for badge-block:
 *
 *   fields    `Label` — Single-Line Text. The badge's text content (the
 *             component's `children` slot in React).
 *
 *   variants  `default | bold | outline | rounded | rounded-bold` — the
 *             structural CVA axis. Each becomes a Variant item under
 *             <BadgeBlock>/Variants, selected per-placement via
 *             FieldNames.
 *
 *   params    `Size`, `ColorScheme` — orthogonal CVA modifiers.
 */
export const badgeBlockRecipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "badge-block@1",
  name: "BadgeBlock",
  displayName: "Badge",
  description:
    "Short label for status, tags, or metadata. Structural variants and orthogonal size/color modifiers.",

  fields: [
    {
      name: "Label",
      shape: "text",
      sitecore: {
        type: "single-line-text",
        required: true,
        hint: "The text shown inside the badge.",
        sortOrder: 100,
      },
    },
  ],

  variants: [
    { name: "default" },
    { name: "bold" },
    { name: "outline" },
    { name: "rounded" },
    { name: "rounded-bold" },
  ],

  params: [
    {
      name: "Size",
      shape: "enum",
      values: ["sm", "md", "lg"],
      default: "md",
      sitecore: {
        type: "droplist",
        hint: "Badge size.",
        sortOrder: 100,
      },
    },
    {
      name: "ColorScheme",
      shape: "enum",
      values: ["neutral", "primary", "success", "warning", "destructive"],
      default: "neutral",
      sitecore: {
        type: "droplist",
        hint: "Color scheme.",
        sortOrder: 200,
      },
    },
  ],

  rendering: {
    /**
     * Convention: badge datasources live in the site's Data folder.
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

export default badgeBlockRecipe;
