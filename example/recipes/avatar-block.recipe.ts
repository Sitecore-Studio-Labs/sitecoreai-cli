import type { ComponentTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Recipe for the `AvatarBlock` component (./avatar-block.tsx).
 *
 * The `AuthorVariant` exposes a placeholder for author-controlled child
 * content (e.g. CTA buttons rendered next to the avatar). Exercises the
 * `placeholders` block + `allowedRenderingHandles` cross-recipe restriction.
 *
 * Note: the AvatarBlock React exports two variants — Default (pure React
 * props, no Sitecore fields) and AuthorVariant (Sitecore fields +
 * placeholder). The recipe models the Sitecore-bound surface; the
 * React-only Default variant exists for non-Sitecore consumers and isn't
 * part of the recipe.
 */
export const avatarBlockRecipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "avatar-block@1",
  name: "AvatarBlock",
  displayName: "Avatar",
  description:
    "Person/profile avatar with name, description, and optional placeholder for related content.",

  fields: [
    {
      name: "AuthorName",
      shape: "text",
      sitecore: {
        type: "single-line-text",
        required: true,
        hint: "Display name. Used for initials fallback when no image is set.",
        sortOrder: 100,
      },
    },
    {
      name: "About",
      shape: "text",
      sitecore: {
        type: "multi-line-text",
        hint: "Short description or role (e.g. 'Lead Designer').",
        sortOrder: 200,
      },
    },
    {
      name: "Avatar",
      shape: "image",
      sitecore: {
        hint: "Profile image. Falls back to initials when empty.",
        section: "Media",
        sortOrder: 100,
      },
    },
  ],

  variants: [{ name: "default" }, { name: "author" }],

  params: [
    {
      name: "Size",
      shape: "enum",
      values: ["sm", "md", "lg"],
      default: "md",
      sitecore: {
        type: "droplist",
        hint: "Avatar size.",
        defaultValue: "md",
        sortOrder: 100,
      },
    },
    {
      name: "Layout",
      shape: "enum",
      values: ["row", "stack"],
      default: "row",
      sitecore: {
        type: "droplist",
        hint: "Avatar above (stack) or beside (row) the text.",
        defaultValue: "row",
        sortOrder: 200,
      },
    },
  ],

  // Author variant accepts child renderings beside the avatar (e.g. a CTA
  // for "Read more posts by this author"). Restricting to cta-button@1 as
  // the only allowed child rendering for v1; broaden later.
  placeholders: [
    {
      key: "avatar-author-content",
      allowedRenderingHandles: ["cta-button@1"],
    },
  ],

  rendering: {
    datasourceLocation: "query",
    datasourceLocationQuery: "query:$site/*[@@name='Data']",
    openPropertiesAfterAdd: false,
    otherProperties: {
      IsAutoDatasourceRendering: "true",
    },
  },
} satisfies ComponentTemplateRecipe;

export default avatarBlockRecipe;
