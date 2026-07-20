import { describe, expect, it } from "vitest";
import { flattenLayout } from "../../../src/recipe/compile/flatten-layout";
import type { Layout } from "../../../src/recipe/schema/recipe";

const layout = (placeholders: Layout["placeholders"]): Layout => ({
  placeholders,
});

describe("flattenLayout — nested placeholder key resolution", () => {
  it("appends the DynamicPlaceholderId to a BARE logical child key", () => {
    const out = flattenLayout(
      layout({
        "headless-main": [
          {
            componentHandle: "column-splitter@1",
            params: { DynamicPlaceholderId: "5" },
            placeholders: {
              "column-1": [{ componentHandle: "promo@1" }],
              "column-2": [{ componentHandle: "promo@1" }],
            },
          },
        ],
      })
    );
    const keys = Object.keys(out.placeholders);
    // Bare `column-1` + parent id 5 → `column-1-5`, matching the
    // column-splitter@1 shell's `column-<n>-<DynamicPlaceholderId>` render.
    expect(keys).toContain("/headless-main/column-1-5");
    expect(keys).toContain("/headless-main/column-2-5");
  });

  it("RESOLVES an SXA `{*}` token to the id instead of doubling it (the header-chrome bug)", () => {
    const out = flattenLayout(
      layout({
        "headless-header": [
          {
            componentHandle: "header@1",
            params: { DynamicPlaceholderId: "1" },
            placeholders: {
              "header-start-{*}": [{ componentHandle: "image@1" }],
              "header-nav-{*}": [{ componentHandle: "main-nav@1" }],
            },
          },
        ],
      })
    );
    const keys = Object.keys(out.placeholders);
    // Token replaced → matches the `header@1` shell's `header-start-{*}` →
    // `header-start-1` resolution, so the nested children actually render.
    expect(keys).toContain("/headless-header/header-start-1");
    expect(keys).toContain("/headless-header/header-nav-1");
    // The doubled `<slot>-{*}-<id>` form that orphaned every child is gone.
    expect(keys.some((k) => k.includes("{*}"))).toBe(false);
    expect(keys).not.toContain("/headless-header/header-start-{*}-1");
  });

  it("resolves `{*}` at deeper nesting (mobile-menu inside a `{*}` shell)", () => {
    const out = flattenLayout(
      layout({
        "headless-header": [
          {
            componentHandle: "header@1",
            params: { DynamicPlaceholderId: "1" },
            placeholders: {
              "header-mobile-{*}": [
                {
                  componentHandle: "mobile-menu@1",
                  params: { DynamicPlaceholderId: "2" },
                  placeholders: {
                    "mobile-menu-{*}": [{ componentHandle: "main-nav@1" }],
                  },
                },
              ],
            },
          },
        ],
      })
    );
    const keys = Object.keys(out.placeholders);
    expect(keys).toContain("/headless-header/header-mobile-1");
    expect(keys).toContain("/headless-header/header-mobile-1/mobile-menu-2");
    expect(keys.some((k) => k.includes("{*}"))).toBe(false);
  });
});
