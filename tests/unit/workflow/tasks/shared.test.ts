import { describe, expect, it } from "vitest";
import { parseItemReference } from "../../../../src/workflow/tasks/shared";

describe("parseItemReference", () => {
  it("returns {itemId} for a dashed GUID", () => {
    expect(parseItemReference("110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9")).toEqual({
      itemId: "110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9",
    });
  });

  it("returns {itemId} for an undashed 32-hex GUID", () => {
    expect(parseItemReference("110d559fdea542ea9c1c8a5df7e70ef9")).toEqual({
      itemId: "110d559fdea542ea9c1c8a5df7e70ef9",
    });
  });

  it("returns {itemId} for a braced GUID", () => {
    expect(parseItemReference("{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}")).toEqual({
      itemId: "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}",
    });
  });

  it("returns {path} for a /sitecore/ path", () => {
    expect(parseItemReference("/sitecore/content/MySite/Home")).toEqual({
      path: "/sitecore/content/MySite/Home",
    });
  });

  it("accepts capitalised /Sitecore/ prefix", () => {
    expect(parseItemReference("/Sitecore/content/Home")).toEqual({
      path: "/Sitecore/content/Home",
    });
  });

  it("throws INPUT_INVALID on garbage input", () => {
    expect(() => parseItemReference("not-a-thing")).toThrowError(/not a valid item reference/);
  });

  it("throws on empty input", () => {
    expect(() => parseItemReference("   ")).toThrowError(/empty/);
  });
});
