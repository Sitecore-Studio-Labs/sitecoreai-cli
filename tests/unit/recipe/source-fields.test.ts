import { describe, expect, it } from "vitest";
import {
  renderSourceFields,
  sourceFieldsNeedHandleResolution,
} from "../../../src/recipe/schema/source-fields";

const fakeResolve = (handle: string): string => {
  if (handle === "a@1") return "11111111-1111-1111-1111-111111111111";
  if (handle === "b@1") return "22222222-2222-2222-2222-222222222222";
  if (handle === "accordion-item@1") return "33333333-3333-3333-3333-333333333333";
  throw new Error(`unexpected handle: ${handle}`);
};

const throwResolver = (handle: string): string => {
  throw new Error(`unexpected handle resolution: ${handle}`);
};

describe("renderSourceFields", () => {
  it("returns undefined when no source fields are set", () => {
    expect(renderSourceFields({}, throwResolver)).toBeUndefined();
  });

  it("standalone sourceQuery → `query:<query>` shorthand", () => {
    expect(renderSourceFields({ sourceQuery: "$site/Data" }, throwResolver)).toBe(
      "query:$site/Data"
    );
  });

  it("standalone sourceTypes (single) → IncludeTemplatesForSelection={GUID-uppercase}", () => {
    expect(renderSourceFields({ sourceTypes: ["a@1"] }, fakeResolve)).toBe(
      "IncludeTemplatesForSelection={11111111-1111-1111-1111-111111111111}"
    );
  });

  it("standalone sourceTypes (multiple) → comma-separated curly GUIDs", () => {
    expect(renderSourceFields({ sourceTypes: ["a@1", "b@1"] }, fakeResolve)).toBe(
      "IncludeTemplatesForSelection={11111111-1111-1111-1111-111111111111},{22222222-2222-2222-2222-222222222222}"
    );
  });

  it("standalone sourceScope → `DataSource=<path>`", () => {
    expect(renderSourceFields({ sourceScope: "/sitecore/content/Library" }, throwResolver)).toBe(
      "DataSource=/sitecore/content/Library"
    );
  });

  it("sourceScope + sourceTypes → DataSource + IncludeTemplatesForSelection", () => {
    expect(
      renderSourceFields(
        { sourceScope: "/sitecore/content/Library", sourceTypes: ["accordion-item@1"] },
        fakeResolve
      )
    ).toBe(
      "DataSource=/sitecore/content/Library&IncludeTemplatesForSelection={33333333-3333-3333-3333-333333333333}"
    );
  });

  it("sourceQuery + sourceTypes → DataSource=query:<q> + IncludeTemplatesForSelection", () => {
    expect(
      renderSourceFields({ sourceQuery: "$site/Data", sourceTypes: ["a@1"] }, fakeResolve)
    ).toBe(
      "DataSource=query:$site/Data&IncludeTemplatesForSelection={11111111-1111-1111-1111-111111111111}"
    );
  });

  it("sourceRaw → verbatim, ignores everything else", () => {
    expect(renderSourceFields({ sourceRaw: "/sitecore/content/Tags" }, throwResolver)).toBe(
      "/sitecore/content/Tags"
    );
  });

  it("normalizes handle GUIDs to upper case (Sitecore convention)", () => {
    const out = renderSourceFields(
      { sourceTypes: ["a@1"] },
      () => "abcdef00-1111-2222-3333-444444444444"
    );
    expect(out).toBe("IncludeTemplatesForSelection={ABCDEF00-1111-2222-3333-444444444444}");
  });

  it("treats empty sourceTypes array as absent", () => {
    expect(renderSourceFields({ sourceTypes: [] }, throwResolver)).toBeUndefined();
  });
});

describe("sourceFieldsNeedHandleResolution", () => {
  it("true when sourceTypes has at least one handle", () => {
    expect(sourceFieldsNeedHandleResolution({ sourceTypes: ["a@1"] })).toBe(true);
  });

  it("false when sourceTypes is empty", () => {
    expect(sourceFieldsNeedHandleResolution({ sourceTypes: [] })).toBe(false);
  });

  it("false when only sourceQuery / sourceScope / sourceRaw is set", () => {
    expect(sourceFieldsNeedHandleResolution({ sourceQuery: "$site/Data" })).toBe(false);
    expect(sourceFieldsNeedHandleResolution({ sourceScope: "/x" })).toBe(false);
    expect(sourceFieldsNeedHandleResolution({ sourceRaw: "/x" })).toBe(false);
  });

  it("false when nothing is set", () => {
    expect(sourceFieldsNeedHandleResolution({})).toBe(false);
  });
});
