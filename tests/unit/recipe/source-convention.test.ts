import { describe, expect, it } from "vitest";
import {
  parseSourceConvention,
  renderSourceConvention,
} from "../../../src/recipe/schema/source-convention";

describe("parseSourceConvention", () => {
  it("recognizes `query:` as a query passthrough", () => {
    expect(parseSourceConvention("query:$site/Data")).toEqual({
      kind: "query",
      query: "query:$site/Data",
    });
  });

  it("parses `template:<handle>` to a single-template directive", () => {
    expect(parseSourceConvention("template:accordion-item@1")).toEqual({
      kind: "template",
      handle: "accordion-item@1",
    });
  });

  it("trims whitespace around the handle in `template:`", () => {
    expect(parseSourceConvention("template:  accordion-item@1  ")).toEqual({
      kind: "template",
      handle: "accordion-item@1",
    });
  });

  it("parses `templates:<h1>,<h2>` to a multi-template directive, trimming whitespace", () => {
    expect(parseSourceConvention("templates: a@1 , b@2 ,c@3")).toEqual({
      kind: "templates",
      handles: ["a@1", "b@2", "c@3"],
    });
  });

  it("drops empty entries in `templates:`", () => {
    expect(parseSourceConvention("templates:a@1,,b@1,")).toEqual({
      kind: "templates",
      handles: ["a@1", "b@1"],
    });
  });

  it("parses `datasource:<q>&template:<h>` to a combined directive", () => {
    expect(
      parseSourceConvention("datasource:/sitecore/content/Library&template:accordion-item@1")
    ).toEqual({
      kind: "datasource-template",
      query: "/sitecore/content/Library",
      handle: "accordion-item@1",
    });
  });

  it("falls back to `datasource` (no template suffix)", () => {
    expect(parseSourceConvention("datasource:/sitecore/content/Library")).toEqual({
      kind: "datasource",
      query: "/sitecore/content/Library",
    });
  });

  it("treats unknown prefixes as raw passthrough", () => {
    expect(parseSourceConvention("/sitecore/content/Tags")).toEqual({
      kind: "raw",
      value: "/sitecore/content/Tags",
    });
  });
});

describe("renderSourceConvention", () => {
  const fakeResolve = (handle: string): string => {
    if (handle === "a@1") return "11111111-1111-1111-1111-111111111111";
    if (handle === "b@1") return "22222222-2222-2222-2222-222222222222";
    if (handle === "accordion-item@1") return "33333333-3333-3333-3333-333333333333";
    throw new Error(`unexpected handle: ${handle}`);
  };

  it("query → passthrough", () => {
    expect(renderSourceConvention({ kind: "query", query: "query:$site/Data" }, fakeResolve)).toBe(
      "query:$site/Data"
    );
  });

  it("template → IncludeTemplatesForSelection={GUID-uppercase}", () => {
    expect(renderSourceConvention({ kind: "template", handle: "a@1" }, fakeResolve)).toBe(
      "IncludeTemplatesForSelection={11111111-1111-1111-1111-111111111111}"
    );
  });

  it("templates → comma-separated curly GUIDs", () => {
    expect(
      renderSourceConvention({ kind: "templates", handles: ["a@1", "b@1"] }, fakeResolve)
    ).toBe(
      "IncludeTemplatesForSelection={11111111-1111-1111-1111-111111111111},{22222222-2222-2222-2222-222222222222}"
    );
  });

  it("datasource-template → DataSource + IncludeTemplatesForSelection", () => {
    expect(
      renderSourceConvention(
        {
          kind: "datasource-template",
          query: "/sitecore/content/Library",
          handle: "accordion-item@1",
        },
        fakeResolve
      )
    ).toBe(
      "DataSource=/sitecore/content/Library&IncludeTemplatesForSelection={33333333-3333-3333-3333-333333333333}"
    );
  });

  it("datasource → DataSource only", () => {
    expect(
      renderSourceConvention(
        { kind: "datasource", query: "/sitecore/content/Library" },
        fakeResolve
      )
    ).toBe("DataSource=/sitecore/content/Library");
  });

  it("raw → passthrough", () => {
    expect(renderSourceConvention({ kind: "raw", value: "/literal" }, fakeResolve)).toBe(
      "/literal"
    );
  });

  it("normalizes GUIDs to upper case (Sitecore convention)", () => {
    const out = renderSourceConvention(
      { kind: "template", handle: "a@1" },
      () => "abcdef00-1111-2222-3333-444444444444"
    );
    expect(out).toBe("IncludeTemplatesForSelection={ABCDEF00-1111-2222-3333-444444444444}");
  });
});
