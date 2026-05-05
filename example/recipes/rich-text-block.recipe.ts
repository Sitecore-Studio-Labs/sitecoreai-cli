import type { ComponentTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Recipe for the `RichTextBlock` component (./rich-text-block.tsx).
 *
 * Two fields, five variants matching the React exports (Default,
 * FullWidth, ProseVariant, PageContentVariant, TitleOnlyVariant), and
 * the standard heading-control params shared across content blocks.
 * Exercises:
 *   - `boolean` shape as a param (UseSectionWrapper)
 *   - `defaultValue` on multiple params
 *   - More variants (5) than the earlier examples
 *   - A minimal datasource (text + richText only)
 */
export const richTextBlockRecipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "rich-text-block@1",
  name: "RichTextBlock",
  displayName: "Rich Text",
  description: "Section of rich text with optional heading. Five layout variants.",

  fields: [
    {
      name: "Title",
      shape: "text",
      sitecore: {
        type: "single-line-text",
        hint: "Optional section title shown above the body.",
        sortOrder: 100,
      },
    },
    {
      name: "Body",
      shape: "richText",
      sitecore: {
        hint: "The rich-text body content.",
        sortOrder: 200,
      },
    },
  ],

  variants: [
    { name: "Default" },
    { name: "FullWidth" },
    { name: "Prose" },
    { name: "PageContent" },
    { name: "TitleOnly" },
  ],

  params: [
    {
      name: "UseSectionWrapper",
      shape: "boolean",
      default: "false",
      sitecore: {
        type: "checkbox",
        hint: "Wrap the body in a SectionWrapper using Title as the heading.",
        sortOrder: 100,
      },
    },
    {
      name: "HeadingLayout",
      shape: "enum",
      values: ["section", "centered"],
      default: "section",
      sitecore: {
        type: "droplist",
        hint: "Heading alignment.",
        defaultValue: "section",
        sortOrder: 200,
      },
    },
    {
      name: "HeadingAnimation",
      shape: "enum",
      values: ["none", "fade-up", "fade-in"],
      default: "none",
      sitecore: {
        type: "droplist",
        hint: "Heading entrance animation.",
        defaultValue: "none",
        sortOrder: 300,
      },
    },
    {
      name: "HeadingSize",
      shape: "enum",
      values: ["sm", "default", "lg"],
      default: "default",
      sitecore: {
        type: "droplist",
        hint: "Heading size.",
        defaultValue: "default",
        sortOrder: 400,
      },
    },
  ],

  datasource: {
    autoCreate: true,
    openPropertiesAfterAdd: false,
    query: ["query:$site/*[@@name='Data']"],
  },
} satisfies ComponentTemplateRecipe;

export default richTextBlockRecipe;
