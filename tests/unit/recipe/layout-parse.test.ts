/**
 * Unit tests for the layout-XML parser (`src/recipe/layout/parse.ts`) —
 * the inverse of `emitLayoutXml`.
 *
 * Coverage:
 *  - both wire forms (canonical + delta) decode to the same `ParsedLayout`;
 *  - multi-placement ordering is preserved per placeholder;
 *  - the `par` blob decode (`decodeParBlob`) splits `FieldNames` → variant;
 *  - a full emit → parse round-trip reconstructs the layout structure.
 *
 * `emitLayoutXml` is exercised directly here so the round-trip proves the
 * two halves are genuine inverses, not two independently-drifting encoders.
 */
import { describe, expect, it } from "vitest";
import { emitLayoutXml, type LayoutEmitContext } from "../../../src/recipe/layout/emit";
import {
  decodeParBlob,
  layoutXmlEquivalent,
  parseLayoutXml,
} from "../../../src/recipe/layout/parse";

// Real uuidv5 outputs — uuid v14's strict validate() rejects sequential
// patterns, so these are derived hashes (mirrors layout-emit.test.ts).
const FAKE_PARENT = "07fb9df4-9e7b-5f96-8155-bba2a3ae12f3";
const FAKE_DEVICE = "fe5d7fdf-89c0-4d99-9aa3-b5fbd009c9f3";
const FAKE_RENDER_LOGO = "603df982-441a-5e9c-82d0-2c4e016f0f7b";
const FAKE_RENDER_NAV = "a5d28163-90a6-5f5d-b54a-fc73c80b9c54";
const FAKE_CONTENT_LOGO = "bdd465b4-58a9-5f50-8c87-cf61d50b3965";
const FAKE_CONTENT_NAV = "70ecf4d2-92ba-54d9-bb49-c517e44a741f";
const FAKE_LAYOUT = "96e5f4ba-a2cf-4a4c-a4e7-64da88226362";

const norm = (g: string) => g.toLowerCase().replace(/[{}-]/g, "");

const baseCtx: LayoutEmitContext = {
  parentItemId: FAKE_PARENT,
  deviceId: FAKE_DEVICE,
  renderingIdFor: (handle) => {
    if (handle === "site-logo@1") return FAKE_RENDER_LOGO;
    if (handle === "primary-nav@1") return FAKE_RENDER_NAV;
    throw new Error(`unknown rendering handle: ${handle}`);
  },
  contentItemIdFor: (handle) => {
    if (handle === "site-logo-content@1") return FAKE_CONTENT_LOGO;
    if (handle === "primary-nav-content@1") return FAKE_CONTENT_NAV;
    throw new Error(`unknown content-item handle: ${handle}`);
  },
  allowScoped: false,
};

// ─────────────────────────────────────────────────────────────────────────
// decodeParBlob — the par blob decode
// ─────────────────────────────────────────────────────────────────────────

describe("decodeParBlob", () => {
  it("returns an empty object for an empty / whitespace blob", () => {
    expect(decodeParBlob("")).toEqual({});
    expect(decodeParBlob("   ")).toEqual({});
  });

  it("lifts FieldNames out as `variant`", () => {
    expect(decodeParBlob("FieldNames=FullWidth")).toEqual({ variant: "FullWidth" });
  });

  it("keeps non-FieldNames pairs in `params`", () => {
    expect(decodeParBlob("Size=lg&Tone=primary")).toEqual({
      params: { Size: "lg", Tone: "primary" },
    });
  });

  it("splits a mixed blob into variant + params", () => {
    expect(decodeParBlob("FieldNames=Hero&Size=lg")).toEqual({
      variant: "Hero",
      params: { Size: "lg" },
    });
  });

  it("URL-decodes keys and values (spaces, ampersands)", () => {
    // encodeURIComponent emits %20 for space and %26 for a literal &.
    const blob = "Call%20To%20Action=Buy%20%26%20Save";
    expect(decodeParBlob(blob)).toEqual({
      params: { "Call To Action": "Buy & Save" },
    });
  });

  it("omits `params` entirely when only FieldNames is present", () => {
    const decoded = decodeParBlob("FieldNames=Default");
    expect(decoded.params).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// parseLayoutXml — empty / shell inputs
// ─────────────────────────────────────────────────────────────────────────

describe("parseLayoutXml — empty and shell inputs", () => {
  it("returns empty placeholders for an empty string", () => {
    expect(parseLayoutXml("")).toEqual({ placeholders: {}, mode: "canonical" });
  });

  it("returns empty placeholders for a device shell with no renderings", () => {
    const xml = emitLayoutXml({ placeholders: {} }, { ...baseCtx, layoutId: FAKE_LAYOUT });
    const parsed = parseLayoutXml(xml);
    expect(parsed.placeholders).toEqual({});
    expect(parsed.layoutId).toBe(norm(FAKE_LAYOUT));
  });

  it("throws on a string that is not layout XML", () => {
    expect(() => parseLayoutXml("not xml at all")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// canonical wire form
// ─────────────────────────────────────────────────────────────────────────

describe("parseLayoutXml — canonical wire form", () => {
  it("parses a single placement with a shared datasource", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            {
              componentHandle: "site-logo@1",
              datasourceRef: { kind: "shared", handle: "site-logo-content@1" },
            },
          ],
        },
      },
      baseCtx
    );
    const parsed = parseLayoutXml(xml);
    expect(parsed.mode).toBe("canonical");
    const placements = parsed.placeholders["/header"];
    expect(placements).toHaveLength(1);
    expect(placements[0].renderingGuid).toBe(norm(FAKE_RENDER_LOGO));
    expect(placements[0].datasource).toEqual({
      kind: "guid",
      guid: norm(FAKE_CONTENT_LOGO),
    });
  });

  it("parses a placement with no datasource (kind: none)", () => {
    const xml = emitLayoutXml(
      { placeholders: { "/main": [{ componentHandle: "site-logo@1" }] } },
      baseCtx
    );
    const parsed = parseLayoutXml(xml);
    expect(parsed.placeholders["/main"][0].datasource).toBeUndefined();
  });

  it("parses variant + params off the par blob", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/main": [
            {
              componentHandle: "site-logo@1",
              variant: "FullWidth",
              params: { Size: "lg" },
            },
          ],
        },
      },
      baseCtx
    );
    const parsed = parseLayoutXml(xml);
    const placement = parsed.placeholders["/main"][0];
    expect(placement.variant).toBe("FullWidth");
    expect(placement.params).toEqual({ Size: "lg" });
  });

  it("recovers the JSON Layout id off the device element", () => {
    const xml = emitLayoutXml(
      { placeholders: { "/main": [{ componentHandle: "site-logo@1" }] } },
      { ...baseCtx, layoutId: FAKE_LAYOUT }
    );
    expect(parseLayoutXml(xml).layoutId).toBe(norm(FAKE_LAYOUT));
  });

  it("preserves placement order across multiple placeholders", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            { componentHandle: "site-logo@1" },
            { componentHandle: "primary-nav@1" },
          ],
          "/footer": [{ componentHandle: "primary-nav@1" }],
        },
      },
      baseCtx
    );
    const parsed = parseLayoutXml(xml);
    expect(parsed.placeholders["/header"].map((p) => p.renderingGuid)).toEqual([
      norm(FAKE_RENDER_LOGO),
      norm(FAKE_RENDER_NAV),
    ]);
    expect(parsed.placeholders["/footer"]).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// delta wire form
// ─────────────────────────────────────────────────────────────────────────

describe("parseLayoutXml — delta wire form", () => {
  it("detects delta mode and skips the <p:da> directive element", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            {
              componentHandle: "site-logo@1",
              datasourceRef: { kind: "shared", handle: "site-logo-content@1" },
            },
          ],
        },
      },
      { ...baseCtx, mode: "delta" }
    );
    const parsed = parseLayoutXml(xml);
    expect(parsed.mode).toBe("delta");
    // Exactly one rendering — the <p:da name="l" /> directive must not be
    // counted as a placement.
    const all = Object.values(parsed.placeholders).flat();
    expect(all).toHaveLength(1);
    expect(all[0].renderingGuid).toBe(norm(FAKE_RENDER_LOGO));
    expect(all[0].datasource).toEqual({ kind: "guid", guid: norm(FAKE_CONTENT_LOGO) });
  });

  it("decodes the always-present s:par attribute", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/main": [{ componentHandle: "site-logo@1", variant: "Outline" }],
        },
      },
      { ...baseCtx, mode: "delta" }
    );
    const placement = parseLayoutXml(xml).placeholders["/main"][0];
    expect(placement.variant).toBe("Outline");
  });

  it("preserves multi-placement ordering in delta form", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            { componentHandle: "site-logo@1" },
            { componentHandle: "primary-nav@1" },
            { componentHandle: "site-logo@1" },
          ],
        },
      },
      { ...baseCtx, mode: "delta" }
    );
    const parsed = parseLayoutXml(xml);
    expect(parsed.placeholders["/header"].map((p) => p.renderingGuid)).toEqual([
      norm(FAKE_RENDER_LOGO),
      norm(FAKE_RENDER_NAV),
      norm(FAKE_RENDER_LOGO),
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// emit → parse round-trip — both forms reconstruct the same structure
// ─────────────────────────────────────────────────────────────────────────

describe("parseLayoutXml — emit → parse round-trip", () => {
  const layout = {
    placeholders: {
      "/header": [
        {
          componentHandle: "site-logo@1",
          variant: "FullWidth",
          params: { Size: "lg", Tone: "primary" },
          datasourceRef: { kind: "shared" as const, handle: "site-logo-content@1" },
        },
        {
          componentHandle: "primary-nav@1",
          datasourceRef: { kind: "shared" as const, handle: "primary-nav-content@1" },
        },
      ],
      "/footer": [{ componentHandle: "primary-nav@1" }],
    },
  };

  it("canonical and delta forms parse to the same placement structure", () => {
    const canonical = parseLayoutXml(emitLayoutXml(layout, baseCtx));
    const delta = parseLayoutXml(emitLayoutXml(layout, { ...baseCtx, mode: "delta" }));

    // Both forms recover the same placeholder keys, ordering, GUIDs,
    // variants and params — the only diff (`mode`) is intentional.
    const strip = (p: ReturnType<typeof parseLayoutXml>) => p.placeholders;
    expect(strip(canonical)).toEqual(strip(delta));

    const header = canonical.placeholders["/header"];
    expect(header[0].variant).toBe("FullWidth");
    expect(header[0].params).toEqual({ Size: "lg", Tone: "primary" });
    expect(header[0].datasource).toEqual({ kind: "guid", guid: norm(FAKE_CONTENT_LOGO) });
    expect(header[1].renderingGuid).toBe(norm(FAKE_RENDER_NAV));
    expect(canonical.placeholders["/footer"][0].params).toBeUndefined();
  });

  it("round-trips a scoped placement's local: sentinel", () => {
    // allowScoped + no resolver → emitLayoutXml writes a `local:<slot>` ds.
    const scopedLayout = {
      placeholders: {
        "/main": [
          {
            componentHandle: "site-logo@1",
            datasourceRef: { kind: "scoped" as const, slot: "hero-content" },
          },
        ],
      },
    };
    const xml = emitLayoutXml(scopedLayout, { ...baseCtx, allowScoped: true });
    const placement = parseLayoutXml(xml).placeholders["/main"][0];
    expect(placement.datasource).toEqual({ kind: "local", slot: "hero-content" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// layoutXmlEquivalent — the planner's wire-form-agnostic layout diff
// ─────────────────────────────────────────────────────────────────────────

describe("layoutXmlEquivalent", () => {
  const layout = {
    placeholders: {
      "/header": [
        {
          componentHandle: "site-logo@1",
          variant: "FullWidth",
          params: { Size: "lg", Tone: "primary" },
          datasourceRef: { kind: "shared" as const, handle: "site-logo-content@1" },
        },
        {
          componentHandle: "primary-nav@1",
          datasourceRef: { kind: "shared" as const, handle: "primary-nav-content@1" },
        },
      ],
    },
  };

  it("treats the canonical and delta wire forms of one layout as equivalent", () => {
    // This is the fix: scai emits canonical, Sitecore stores delta — the
    // planner must NOT see that as drift.
    const canonical = emitLayoutXml(layout, baseCtx);
    const delta = emitLayoutXml(layout, { ...baseCtx, mode: "delta" });
    expect(canonical).not.toBe(delta); // genuinely different strings
    expect(layoutXmlEquivalent(canonical, delta)).toBe(true);
  });

  it("is order-insensitive on params but order-sensitive on placements", () => {
    const reordered = {
      placeholders: {
        "/header": [layout.placeholders["/header"][1], layout.placeholders["/header"][0]],
      },
    };
    expect(layoutXmlEquivalent(emitLayoutXml(layout, baseCtx), emitLayoutXml(layout, baseCtx))).toBe(
      true
    );
    // Swapped placement order is a real difference.
    expect(
      layoutXmlEquivalent(emitLayoutXml(layout, baseCtx), emitLayoutXml(reordered, baseCtx))
    ).toBe(false);
  });

  it("flags a genuinely different layout", () => {
    const dropped = { placeholders: { "/header": [layout.placeholders["/header"][0]] } };
    expect(
      layoutXmlEquivalent(emitLayoutXml(layout, baseCtx), emitLayoutXml(dropped, baseCtx))
    ).toBe(false);
  });

  it("treats two empty layouts as equivalent and falls back for malformed input", () => {
    expect(layoutXmlEquivalent("", "")).toBe(true);
    expect(layoutXmlEquivalent("not xml", "also not xml")).toBe(false);
  });
});
