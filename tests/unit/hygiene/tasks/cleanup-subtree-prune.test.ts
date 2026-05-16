import { describe, expect, it } from "vitest";
import {
  pruneFieldValue,
  pruneMultiList,
  pruneRenderingsXml,
} from "../../../../src/hygiene/tasks/cleanup/subtree-prune";

const flat = (s: string) => s.toLowerCase().replace(/[{}-]/g, "");

const TARGET_A = "abc12345-0000-0000-0000-000000000001";
const TARGET_B = "def67890-0000-0000-0000-000000000002";
const SURVIVOR = "11111111-2222-3333-4444-555555555555";

const targets = new Set([flat(TARGET_A), flat(TARGET_B)]);

describe("pruneMultiList", () => {
  it("returns null for non-multi-list shapes", () => {
    expect(pruneMultiList("plain text", targets)).toBe(null);
    expect(pruneMultiList("text with | a pipe but not GUIDs", targets)).toBe(null);
    expect(pruneMultiList("<r><d></d></r>", targets)).toBe(null);
  });

  it("removes target entries and preserves survivors and formatting", () => {
    const value = `{${TARGET_A.toUpperCase()}}|{${SURVIVOR.toUpperCase()}}|{${TARGET_B.toUpperCase()}}`;
    expect(pruneMultiList(value, targets)).toBe(`{${SURVIVOR.toUpperCase()}}`);
  });

  it("returns empty string when every entry is a target", () => {
    const value = `{${TARGET_A.toUpperCase()}}|{${TARGET_B.toUpperCase()}}`;
    expect(pruneMultiList(value, targets)).toBe("");
  });

  it("handles a single-entry GUID list (no pipe)", () => {
    expect(pruneMultiList(`{${TARGET_A.toUpperCase()}}`, targets)).toBe("");
    expect(pruneMultiList(`{${SURVIVOR.toUpperCase()}}`, targets)).toBe(
      `{${SURVIVOR.toUpperCase()}}`
    );
  });

  it("matches across canonical forms (curly-upper, curly-lower, bare-dashed)", () => {
    const value = [`{${TARGET_A.toUpperCase()}}`, TARGET_B, `{${SURVIVOR.toLowerCase()}}`].join(
      "|"
    );
    expect(pruneMultiList(value, targets)).toBe(`{${SURVIVOR.toLowerCase()}}`);
  });
});

describe("pruneRenderingsXml", () => {
  it("returns null for non-renderings values", () => {
    expect(pruneRenderingsXml("plain text", targets)).toBe(null);
    expect(pruneRenderingsXml(`{${TARGET_A}}|{${TARGET_B}}`, targets)).toBe(null);
  });

  it("drops <r/> elements whose id attribute matches a target", () => {
    const xml =
      `<r xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r id="{${TARGET_A.toUpperCase()}}" placeh="/header" uid="{aaa11111-1111-1111-1111-111111111111}" />` +
      `<r id="{${SURVIVOR.toUpperCase()}}" placeh="/main" uid="{bbb22222-2222-2222-2222-222222222222}" />` +
      `</d></r>`;

    const pruned = pruneRenderingsXml(xml, targets);

    expect(pruned).not.toBe(null);
    expect(pruned).not.toContain(TARGET_A.toUpperCase());
    expect(pruned).toContain(SURVIVOR.toUpperCase());
    // Outer wrapper survives.
    expect(pruned).toContain('xmlns:xsd="http://www.w3.org/2001/XMLSchema"');
  });

  it("drops <r/> elements whose ds attribute matches a target", () => {
    const xml =
      `<r xmlns:xsd="x" xmlns:xsi="y">` +
      `<d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r id="{${SURVIVOR.toUpperCase()}}" placeh="/main" ds="{${TARGET_B.toUpperCase()}}" uid="{ccc33333-3333-3333-3333-333333333333}" />` +
      `<r id="{${SURVIVOR.toUpperCase()}}" placeh="/main" ds="{${SURVIVOR.toUpperCase()}}" uid="{ddd44444-4444-4444-4444-444444444444}" />` +
      `</d></r>`;

    const pruned = pruneRenderingsXml(xml, targets);
    expect(pruned).not.toBeNull();
    // The rendering pointing at TARGET_B as a datasource should be removed.
    expect(pruned).not.toContain(TARGET_B.toUpperCase());
    // The rendering with a clean datasource survives.
    expect(pruned).toMatch(/uid="\{ddd44444-/);
  });

  it("handles SXA delta-form `s:id` / `s:ds` attributes", () => {
    const xml =
      `<r xmlns:p="p" xmlns:s="s" p:p="1">` +
      `<d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<p:da name="l" />` +
      `<r uid="{aaa11111-1111-1111-1111-111111111111}" p:before="*" s:placeh="/main" s:id="{${TARGET_A.toUpperCase()}}" s:par="" />` +
      `<r uid="{bbb22222-2222-2222-2222-222222222222}" p:before="*" s:placeh="/main" s:id="{${SURVIVOR.toUpperCase()}}" s:par="" />` +
      `</d></r>`;

    const pruned = pruneRenderingsXml(xml, targets);
    expect(pruned).not.toBeNull();
    expect(pruned).not.toContain(TARGET_A.toUpperCase());
    expect(pruned).toContain(SURVIVOR.toUpperCase());
  });

  it("ignores non-GUID `ds` values (path sentinels, local: refs)", () => {
    const xml =
      `<r xmlns:xsd="x" xmlns:xsi="y">` +
      `<d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r id="{${SURVIVOR.toUpperCase()}}" placeh="/main" ds="local:slot-a" uid="{aaa11111-1111-1111-1111-111111111111}" />` +
      `</d></r>`;

    // Should NOT throw; ds="local:slot-a" isn't a GUID and isn't a target.
    expect(pruneRenderingsXml(xml, targets)).toBe(xml);
  });
});

describe("pruneFieldValue (dispatch)", () => {
  it("prefers renderings-XML pruner when both could match", () => {
    const xml =
      `<r xmlns:xsd="x" xmlns:xsi="y">` +
      `<d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r id="{${TARGET_A.toUpperCase()}}" placeh="/main" uid="{aaa11111-1111-1111-1111-111111111111}" />` +
      `</d></r>`;
    expect(pruneFieldValue(xml, targets)).not.toContain(TARGET_A.toUpperCase());
  });

  it("falls back to multi-list when value isn't XML", () => {
    const list = `{${TARGET_A.toUpperCase()}}|{${SURVIVOR.toUpperCase()}}`;
    expect(pruneFieldValue(list, targets)).toBe(`{${SURVIVOR.toUpperCase()}}`);
  });

  it("returns null for single-value non-GUID-shaped strings (caller falls back to clear)", () => {
    expect(pruneFieldValue("some plain text", targets)).toBe(null);
    expect(pruneFieldValue("https://example.com/page", targets)).toBe(null);
  });
});
