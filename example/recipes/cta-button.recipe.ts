import type { ComponentTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 1 worked example. Mirrors the registry's authored recipe at
 * `<registry>/src/components/registry/blocks/sitecore/ui/cta-button.recipe.ts`.
 *
 * Bucket choices for cta-button:
 *
 *   fields    `Link` — General Link. Per-content; the link text doubles as
 *             the button label, so no separate `Label` field is needed.
 *
 *   variants  `default | outline | ghost | link` — the structural CVA axis
 *             from the Button primitive. Selected per-placement via
 *             FieldNames; each becomes a Variant item under
 *             <CtaButton>/Variants.
 *
 *   params    `Size`, `ColorScheme` — orthogonal CVA modifiers. Plain
 *             rendering parameters; picked per-placement.
 *
 * Compiles to 17 ordered Authoring GraphQL operations — see
 * `tests/unit/recipe/compile.test.ts` for the assertion.
 */
export const ctaButtonRecipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "cta-button@1",
  name: "CtaButton",
  displayName: "CTA Button",
  description:
    "Call-to-action button with a Sitecore link field, structural variants, and presentation params.",

  fields: [
    {
      name: "Link",
      shape: "link",
      sitecore: {
        type: "general-link",
        required: true,
        hint: "Where the button goes. The link text doubles as the button label.",
        sortOrder: 100,
      },
    },
  ],

  variants: [{ name: "Default" }, { name: "Outline" }, { name: "Ghost" }, { name: "Link" }],

  params: [
    {
      name: "Size",
      shape: "enum",
      values: ["default", "lg", "sm", "xs"],
      default: "default",
      sitecore: {
        type: "droplist",
        hint: "Button size.",
        sortOrder: 100,
      },
    },
    {
      name: "ColorScheme",
      shape: "enum",
      values: ["primary", "neutral", "success", "destructive", "ai"],
      default: "primary",
      sitecore: {
        type: "droplist",
        hint: "Color scheme.",
        sortOrder: 200,
      },
    },
  ],

  datasource: {
    autoCreate: true,
    openPropertiesAfterAdd: false,
    query: ["query:$site/*[@@name='Data']"],
  },
} satisfies ComponentTemplateRecipe;
