import { z } from "zod";

/**
 * Two related taxonomies for recipe-defined fields:
 *
 * - `FieldShape` — abstract data shape from the React component's
 *   perspective (text, image, link, enum, …). Recipe authors write this.
 * - `SitecoreFieldType` — the canonical Sitecore field-type *string*
 *   (Single-Line Text, Rich Text, …) stored verbatim in the field item's
 *   `Type` shared field. Sitecore stores this as a string, NOT a GUID.
 *
 * The compiler maps `shape` → default Sitecore type, overridable
 * per-field via `sitecore.type` on the recipe.
 *
 * **This taxonomy must stay in sync with the registry's working copy at
 * `<registry>/src/lib/registry/sitecore-recipes.ts`.** Once scai exposes
 * a typed recipe export, the registry will import it and this duplication
 * goes away.
 */

export const FIELD_SHAPES = [
  "text",
  "richText",
  "image",
  "link",
  "boolean",
  "number",
  "integer",
  "date",
  "datetime",
  "enum",
  "reference",
] as const;

export type FieldShape = (typeof FIELD_SHAPES)[number];

export const FieldShapeSchema = z.enum(FIELD_SHAPES);

export const SITECORE_FIELD_TYPES = [
  "single-line-text",
  "multi-line-text",
  "rich-text",
  "image",
  "file",
  "general-link",
  "checkbox",
  "number",
  "integer",
  "date",
  "datetime",
  "droplist",
  "droplink",
  "treelist",
  "treelist-with-search",
  "lookup",
  "tags",
] as const;

export type SitecoreFieldType = (typeof SITECORE_FIELD_TYPES)[number];

export const SitecoreFieldTypeSchema = z.enum(SITECORE_FIELD_TYPES);

const SITECORE_FIELD_TYPE_LABEL: Record<SitecoreFieldType, string> = {
  "single-line-text": "Single-Line Text",
  "multi-line-text": "Multi-Line Text",
  "rich-text": "Rich Text",
  image: "Image",
  file: "File",
  "general-link": "General Link",
  checkbox: "Checkbox",
  number: "Number",
  integer: "Integer",
  date: "Date",
  datetime: "Datetime",
  droplist: "Droplist",
  droplink: "Droplink",
  treelist: "Treelist",
  "treelist-with-search": "Treelist with Search",
  lookup: "Lookup",
  tags: "Tags",
};

/** Stored verbatim in the field item's `Type` shared field. */
export const sitecoreFieldTypeLabel = (type: SitecoreFieldType): string =>
  SITECORE_FIELD_TYPE_LABEL[type];

/**
 * Map an abstract field shape to its default Sitecore field type.
 * `reference` resolves to `treelist` when `multiple === true`, otherwise
 * `droplink`. All other shapes are 1:1.
 *
 * `enum` maps to `droplink` (NOT droplist): SXA Headless rendering
 * parameters and content fields back enumerated values with item-shaped
 * Droplink references — the editor enumerates the source location's
 * children at edit time. Pipe-delimited Droplist Source is the older
 * vanilla-Sitecore pattern and is not how working SXA Headless params
 * fields are wired (verified against tenant introspection 2026-05-02).
 * Authors who specifically need a Droplist can override via
 * `sitecore.type: "droplist"` on the field.
 */
export const defaultSitecoreFieldType = (
  shape: FieldShape,
  multiple?: boolean
): SitecoreFieldType => {
  switch (shape) {
    case "text":
      return "single-line-text";
    case "richText":
      return "rich-text";
    case "image":
      return "image";
    case "link":
      return "general-link";
    case "boolean":
      return "checkbox";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "enum":
      return "droplink";
    case "reference":
      return multiple ? "treelist" : "droplink";
  }
};
