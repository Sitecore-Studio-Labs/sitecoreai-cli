import type { ComponentTemplateRecipe } from "../../src/recipe/schema/recipe";

/**
 * Recipe for the `AccordionBlock` component (./accordion-block.tsx).
 *
 * Demonstrates BOTH accordion-item modeling patterns simultaneously — the
 * React component handles either resolution path, so tenants pick the
 * authoring flow they prefer:
 *
 *   1. Related-items pattern (Treelist): the `Items` field is a Treelist
 *      whose source restricts the picker to `accordion-item@1` items.
 *      Items live wherever the tenant likes — typically a shared library
 *      folder — and are referenced by GUID. Reusable across multiple
 *      accordion-blocks.
 *
 *   2. Child-items pattern (insertOptions): `insertOptions` allows
 *      `accordion-item@1` as a direct child of the AccordionBlock
 *      datasource item. Items live under the accordion they belong to;
 *      the React component reads them via the datasource's child
 *      resolution. Closer ownership, less reuse.
 *
 * Sets up `Items` for pattern (1) AND `insertOptions` for pattern (2).
 * Either or both can be used per placement.
 */
export const accordionBlockRecipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "accordion-block@1",
  name: "AccordionBlock",
  displayName: "Accordion",
  description:
    "Collapsible section list. Supports both related-items (Treelist) and child-items (insertOptions) modeling.",

  fields: [
    {
      name: "Heading",
      shape: "text",
      sitecore: {
        type: "single-line-text",
        hint: "Optional heading shown above the accordion.",
        sortOrder: 100,
      },
    },
    {
      name: "Items",
      shape: "reference",
      multiple: true,
      sitecore: {
        type: "treelist",
        // Compiler resolves each handle in source.types to its deterministic
        // template GUID and emits IncludeTemplatesForSelection={GUID},...
        source: { kind: "filter", types: ["accordion-item@1"] },
        hint: "Pick accordion items to include. Each must be of the AccordionItem template.",
        sortOrder: 200,
      },
    },
  ],

  // Child-items pattern: authors can also create accordion-items directly
  // under this accordion's datasource as children. Either pattern works.
  insertOptions: ["accordion-item@1"],

  variants: [{ name: "Default" }, { name: "Media" }],

  params: [
    {
      name: "UseSectionWrapper",
      shape: "boolean",
      default: "false",
      sitecore: {
        type: "checkbox",
        hint: "Wrap the accordion in a SectionWrapper with the heading.",
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

export default accordionBlockRecipe;
