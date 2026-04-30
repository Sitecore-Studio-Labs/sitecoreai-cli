import { describe, expect, it } from "vitest";
import { encodeTemplatesMapping } from "../../../src/recipe/layout/templates-mapping";

describe("encodeTemplatesMapping", () => {
  it("returns an empty string for an empty list", () => {
    expect(encodeTemplatesMapping([])).toBe("");
  });

  it("encodes a single mapping with curly-uppercase GUIDs and URL-encodes them", () => {
    const result = encodeTemplatesMapping([
      {
        templateGuid: "11111111-1111-1111-1111-111111111111",
        designGuid: "22222222-2222-2222-2222-222222222222",
      },
    ]);
    expect(result).toBe(
      "%7B11111111-1111-1111-1111-111111111111%7D=%7B22222222-2222-2222-2222-222222222222%7D"
    );
  });

  it("joins multiple entries with & in URL-encoded form", () => {
    const result = encodeTemplatesMapping([
      {
        templateGuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        designGuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      },
      {
        templateGuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        designGuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      },
    ]);
    expect(result).toBe(
      "%7BAAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA%7D=%7BBBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB%7D" +
        "&" +
        "%7BCCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC%7D=%7BDDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD%7D"
    );
  });

  it("normalizes lowercase GUIDs to upper-case curly form before URL-encoding", () => {
    const result = encodeTemplatesMapping([
      {
        templateGuid: "abcdef00-1111-2222-3333-444444444444",
        designGuid: "11abcdef-0000-1111-2222-333333333333",
      },
    ]);
    expect(result).toContain("ABCDEF00-1111-2222-3333-444444444444");
    expect(result).toContain("11ABCDEF-0000-1111-2222-333333333333");
    expect(result).not.toContain("abcdef00");
  });
});
