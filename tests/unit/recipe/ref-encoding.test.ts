import { describe, expect, it } from "vitest";
import { renderRefValue, resolveRecipeRefs } from "../../../src/recipe/api/ref-encoding";

describe("renderRefValue", () => {
  it("passes plain strings through unchanged", () => {
    expect(renderRefValue({ kind: "string", value: "Single-Line Text" })).toBe("Single-Line Text");
  });

  it("encodes booleans as Sitecore's '0'/'1'", () => {
    expect(renderRefValue({ kind: "bool", value: true })).toBe("1");
    expect(renderRefValue({ kind: "bool", value: false })).toBe("0");
  });

  it("renders numbers as their decimal string", () => {
    expect(renderRefValue({ kind: "number", value: 100 })).toBe("100");
  });

  it("wraps GUIDs in upper-case curly braces", () => {
    expect(
      renderRefValue({ kind: "ref-guid", value: "603df982-441a-5e9c-82d0-2c4e016f0f7b" })
    ).toBe("{603DF982-441A-5E9C-82D0-2C4E016F0F7B}");
  });

  it("pipe-separates a multi-GUID list", () => {
    expect(
      renderRefValue({
        kind: "ref-guid-list",
        values: ["603df982-441a-5e9c-82d0-2c4e016f0f7b", "1930bbeb-7805-471a-a3be-4858ac7cf696"],
      })
    ).toBe("{603DF982-441A-5E9C-82D0-2C4E016F0F7B}|{1930BBEB-7805-471A-A3BE-4858AC7CF696}");
  });

  it("returns paths and queries verbatim", () => {
    expect(renderRefValue({ kind: "ref-path", value: "/sitecore/templates/A" })).toBe(
      "/sitecore/templates/A"
    );
    expect(renderRefValue({ kind: "query", value: "query:$site/Data" })).toBe("query:$site/Data");
  });

  it("URL-encodes a key/value map", () => {
    expect(
      renderRefValue({
        kind: "url-string-map",
        entries: { "a b": "c d", "x=y": "1&2" },
      })
    ).toBe("a%20b=c%20d&x%3Dy=1%262");
  });
});

describe("resolveRecipeRefs / media-xml-ref", () => {
  it("resolves a captured media itemId to the SXA media-XML wrapper", () => {
    const refKey = "603df982-441a-5e9c-82d0-2c4e016f0f7b";
    // Authoring API typically returns itemIds in undashed form — the
    // resolver must dashify before wrapping (matches the dashifyGuid
    // path the production authoring client takes for getItem replies).
    const captured = new Map<string, string>([[refKey, "dc97e7c3c91849e48da1137cba29855a"]]);
    const resolved = resolveRecipeRefs({ kind: "media-xml-ref", refKey }, captured);
    expect(resolved).toEqual({
      kind: "string",
      value: '<image mediaid="{DC97E7C3-C918-49E4-8DA1-137CBA29855A}" />',
    });
  });

  it("dashifies already-dashed input GUIDs idempotently", () => {
    const refKey = "603df982-441a-5e9c-82d0-2c4e016f0f7b";
    const captured = new Map<string, string>([[refKey, "DC97E7C3-C918-49E4-8DA1-137CBA29855A"]]);
    const resolved = resolveRecipeRefs({ kind: "media-xml-ref", refKey }, captured);
    expect(resolved).toEqual({
      kind: "string",
      value: '<image mediaid="{DC97E7C3-C918-49E4-8DA1-137CBA29855A}" />',
    });
  });

  it("throws a clear error when the producer MediaUpload didn't capture", () => {
    const refKey = "603df982-441a-5e9c-82d0-2c4e016f0f7b";
    expect(() => resolveRecipeRefs({ kind: "media-xml-ref", refKey }, new Map())).toThrow(
      /not in captured map/
    );
  });

  it("rejects render of an unresolved media-xml-ref", () => {
    const refKey = "603df982-441a-5e9c-82d0-2c4e016f0f7b";
    expect(() => renderRefValue({ kind: "media-xml-ref", refKey })).toThrow(
      /Unresolved media-xml-ref/
    );
  });
});
