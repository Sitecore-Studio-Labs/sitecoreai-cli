import { describe, expect, it } from "vitest";
import {
  buildPathFilterStatement,
  dashifyItemId,
  extractInternalRefs,
  extractMediaRefs,
  isSystemPath,
  normalizeItemId,
} from "../../../../src/hygiene/tasks/shared";

describe("normalizeItemId / dashifyItemId", () => {
  it("strips braces, dashes, and lowercases", () => {
    expect(normalizeItemId("{ABCDEF12-3456-7890-ABCD-EF1234567890}")).toBe(
      "abcdef1234567890abcdef1234567890"
    );
  });

  it("dashifies a flat 32-char id back to canonical form", () => {
    expect(dashifyItemId("abcdef1234567890abcdef1234567890")).toBe(
      "abcdef12-3456-7890-abcd-ef1234567890"
    );
  });

  it("dashifies an already-dashed id idempotently", () => {
    expect(dashifyItemId("abcdef12-3456-7890-abcd-ef1234567890")).toBe(
      "abcdef12-3456-7890-abcd-ef1234567890"
    );
  });

  it("returns input unchanged if not 32 chars after normalization", () => {
    expect(dashifyItemId("not-a-guid")).toBe("not-a-guid");
  });
});

describe("extractInternalRefs", () => {
  it("returns an empty array for empty input", () => {
    expect(extractInternalRefs("")).toEqual([]);
    expect(extractInternalRefs("plain text with no guids")).toEqual([]);
  });

  it("extracts bare GUIDs", () => {
    expect(extractInternalRefs("{ABCDEF12-3456-7890-abcd-ef1234567890}")).toEqual([
      "abcdef1234567890abcdef1234567890",
    ]);
  });

  it("extracts pipe-delimited Multilist GUIDs", () => {
    const value = "{11111111-1111-1111-1111-111111111111}|{22222222-2222-2222-2222-222222222222}";
    expect(extractInternalRefs(value)).toEqual([
      "11111111111111111111111111111111",
      "22222222222222222222222222222222",
    ]);
  });

  it("extracts internal link IDs from RichText link tags", () => {
    const value =
      '<p>See <a href="#"><link linktype="internal" id="{ABCDEF12-3456-7890-abcd-ef1234567890}" /></a>.</p>';
    expect(extractInternalRefs(value)).toEqual(["abcdef1234567890abcdef1234567890"]);
  });

  it("returns multiple refs from mixed content", () => {
    const value =
      'before {11111111-1111-1111-1111-111111111111} middle <link id="{22222222-2222-2222-2222-222222222222}" /> end';
    expect(extractInternalRefs(value)).toEqual([
      "11111111111111111111111111111111",
      "22222222222222222222222222222222",
    ]);
  });
});

describe("extractMediaRefs", () => {
  it('extracts media-link refs from RichText <link linktype="media">', () => {
    const value =
      '<link linktype="media" id="{ABCDEF12-3456-7890-abcd-ef1234567890}" url="/media/foo.png" />';
    expect(extractMediaRefs(value)).toEqual(["abcdef1234567890abcdef1234567890"]);
  });

  it("extracts mediaId from <image> field XML", () => {
    const value = '<image mediaid="{11111111-1111-1111-1111-111111111111}" alt="hi" />';
    expect(extractMediaRefs(value)).toEqual(["11111111111111111111111111111111"]);
  });

  it("ignores non-media link tags", () => {
    const value = '<link linktype="internal" id="{abcdef12-3456-7890-abcd-ef1234567890}" />';
    expect(extractMediaRefs(value)).toEqual([]);
  });

  it("handles single quotes around attribute values", () => {
    const value = "<image mediaid='{11111111-1111-1111-1111-111111111111}' />";
    expect(extractMediaRefs(value)).toEqual(["11111111111111111111111111111111"]);
  });
});

describe("isSystemPath / SYSTEM_PATH_PREFIXES", () => {
  it("flags /sitecore/system as system", () => {
    expect(isSystemPath("/sitecore/system/Settings")).toBe(true);
  });

  it("flags /sitecore/templates/System as system", () => {
    expect(isSystemPath("/sitecore/templates/System/Branches")).toBe(true);
  });

  it("does not flag /sitecore/content as system", () => {
    expect(isSystemPath("/sitecore/content/Home")).toBe(false);
  });

  it("does not flag /sitecore/templates/Project as system", () => {
    expect(isSystemPath("/sitecore/templates/Project/MySite")).toBe(false);
  });
});

describe("buildPathFilterStatement", () => {
  it("normalizes the rootItemId and builds a _path CONTAINS criterion", () => {
    const stmt = buildPathFilterStatement("{ABCDEF12-3456-7890-abcd-ef1234567890}");
    expect(stmt).toEqual({
      criteria: {
        field: "_path",
        value: "abcdef1234567890abcdef1234567890",
        criteriaType: "CONTAINS",
      },
    });
  });
});
