import { describe, expect, it } from "vitest";
import {
  FIELD_SHAPES,
  SITECORE_FIELD_TYPES,
  defaultSitecoreFieldType,
  sitecoreFieldTypeLabel,
  type FieldShape,
  type SitecoreFieldType,
} from "../../../src/recipe/schema/field-types";

/**
 * `defaultSitecoreFieldType` covers every shape branch in a single
 * switch. Walk every case to keep the branch table closed; without
 * this the per-shape branches show 0% coverage and skew the global
 * branch percentage.
 *
 * `sitecoreFieldTypeLabel` is the table-lookup companion — round-trip
 * every Sitecore field type to verify the label map is complete.
 */
describe("defaultSitecoreFieldType — every shape branch", () => {
  const expectations: Record<FieldShape, SitecoreFieldType> = {
    text: "single-line-text",
    richText: "rich-text",
    image: "image",
    link: "general-link",
    boolean: "checkbox",
    number: "number",
    integer: "integer",
    date: "date",
    datetime: "datetime",
    enum: "droplink",
    // `reference` defaults to `droplink` when single, `treelist` when multiple.
    reference: "droplink",
  };

  for (const shape of FIELD_SHAPES) {
    it(`maps shape='${shape}' to ${expectations[shape]} when multiple is undefined`, () => {
      expect(defaultSitecoreFieldType(shape)).toBe(expectations[shape]);
    });
  }

  it("maps reference + multiple=true to 'treelist'", () => {
    expect(defaultSitecoreFieldType("reference", true)).toBe("treelist");
  });

  it("maps reference + multiple=false to 'droplink' (single)", () => {
    expect(defaultSitecoreFieldType("reference", false)).toBe("droplink");
  });

  it("ignores the multiple flag for non-reference shapes", () => {
    expect(defaultSitecoreFieldType("text", true)).toBe("single-line-text");
    expect(defaultSitecoreFieldType("text", false)).toBe("single-line-text");
    expect(defaultSitecoreFieldType("enum", true)).toBe("droplink");
  });
});

describe("sitecoreFieldTypeLabel — every Sitecore field type", () => {
  // Labels are the human-display form scai writes verbatim into the
  // field item's `Type` shared field. Every entry in
  // SITECORE_FIELD_TYPES must have a label or `compile` emits the bare
  // token and Sitecore rejects the field at apply time.
  const labels: Record<SitecoreFieldType, string> = {
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
    Plugin: "Plugin",
  };

  for (const type of SITECORE_FIELD_TYPES) {
    it(`labels '${type}' as '${labels[type]}'`, () => {
      expect(sitecoreFieldTypeLabel(type)).toBe(labels[type]);
    });
  }

  it("every SITECORE_FIELD_TYPES member has a label entry (closed-set check)", () => {
    for (const type of SITECORE_FIELD_TYPES) {
      const label = sitecoreFieldTypeLabel(type);
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    }
  });
});
