import { describe, expect, it } from "vitest";
import { emitLayoutXml, type LayoutEmitContext } from "../../../src/recipe/layout/emit";

// Real uuidv5 outputs — uuid v14's strict validate() rejects sequential
// patterns like 11111111-1111-... because the version digit must encode a
// recognized UUID variant. These are derived from uuidv5("…", DNS).
const FAKE_PARENT = "07fb9df4-9e7b-5f96-8155-bba2a3ae12f3";
const FAKE_DEVICE = "fe5d7fdf-89c0-4d99-9aa3-b5fbd009c9f3";
const FAKE_RENDER_LOGO = "603df982-441a-5e9c-82d0-2c4e016f0f7b";
const FAKE_RENDER_NAV = "a5d28163-90a6-5f5d-b54a-fc73c80b9c54";
const FAKE_CONTENT_LOGO = "bdd465b4-58a9-5f50-8c87-cf61d50b3965";
const FAKE_CONTENT_NAV = "70ecf4d2-92ba-54d9-bb49-c517e44a741f";

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

describe("emitLayoutXml — empty layout", () => {
  it("returns an empty string when no placeholders are populated", () => {
    expect(emitLayoutXml({ placeholders: {} }, baseCtx)).toBe("");
  });

  it("returns an empty string when placeholders exist but contain no placements", () => {
    expect(emitLayoutXml({ placeholders: { "/header": [] } }, baseCtx)).toBe("");
  });
});

describe("emitLayoutXml — single placement shapes", () => {
  it("emits a placement with shared datasourceRef", () => {
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
    expect(xml).toContain('<d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">');
    expect(xml).toContain(`id="{${FAKE_RENDER_LOGO.toUpperCase()}}"`);
    expect(xml).toContain('placeh="/header"');
    expect(xml).toContain(`ds="{${FAKE_CONTENT_LOGO.toUpperCase()}}"`);
    expect(xml).toMatch(/uid="\{[0-9A-F-]{36}\}"/);
  });

  it("emits a placement with no datasource (kind: none)", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            {
              componentHandle: "site-logo@1",
              datasourceRef: { kind: "none" },
            },
          ],
        },
      },
      baseCtx
    );
    expect(xml).not.toContain("ds=");
    expect(xml).toContain(`id="{${FAKE_RENDER_LOGO.toUpperCase()}}"`);
  });

  it("emits a placement with no datasourceRef field at all", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [{ componentHandle: "site-logo@1" }],
        },
      },
      baseCtx
    );
    expect(xml).not.toContain("ds=");
  });

  it("encodes variant + params into the par attribute (URL-encoded)", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            {
              componentHandle: "site-logo@1",
              variant: "default",
              params: { Size: "lg" },
              datasourceRef: { kind: "none" },
            },
          ],
        },
      },
      baseCtx
    );
    expect(xml).toContain("par=");
    // Both Size=lg and FieldNames=default present, joined by &amp;
    expect(xml).toMatch(/par="(?=[^"]*Size=lg)(?=[^"]*FieldNames=default)/);
  });

  it("XML-escapes the & between encoded params (URL-encoded `&` becomes `&amp;`)", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            {
              componentHandle: "site-logo@1",
              variant: "default",
              params: { Size: "lg" },
              datasourceRef: { kind: "none" },
            },
          ],
        },
      },
      baseCtx
    );
    expect(xml).toContain("Size=lg&amp;FieldNames=default");
  });
});

describe("emitLayoutXml — multiple placements + multiple placeholders", () => {
  it("preserves array order within a placeholder", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            {
              componentHandle: "site-logo@1",
              datasourceRef: { kind: "shared", handle: "site-logo-content@1" },
            },
            {
              componentHandle: "primary-nav@1",
              datasourceRef: { kind: "shared", handle: "primary-nav-content@1" },
            },
          ],
        },
      },
      baseCtx
    );
    const logoIdx = xml.indexOf(FAKE_RENDER_LOGO.toUpperCase());
    const navIdx = xml.indexOf(FAKE_RENDER_NAV.toUpperCase());
    expect(logoIdx).toBeGreaterThan(0);
    expect(navIdx).toBeGreaterThan(logoIdx);
  });

  it("each placement gets a unique deterministic uid", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            {
              componentHandle: "site-logo@1",
              datasourceRef: { kind: "shared", handle: "site-logo-content@1" },
            },
            {
              componentHandle: "primary-nav@1",
              datasourceRef: { kind: "shared", handle: "primary-nav-content@1" },
            },
          ],
        },
      },
      baseCtx
    );
    const uidMatches = xml.match(/uid="\{[0-9A-F-]{36}\}"/g);
    expect(uidMatches).toHaveLength(2);
    expect(new Set(uidMatches).size).toBe(2);
  });

  it("re-emit of identical input produces identical XML (deterministic uids)", () => {
    const layout = {
      placeholders: {
        "/header": [
          {
            componentHandle: "site-logo@1" as const,
            datasourceRef: { kind: "shared" as const, handle: "site-logo-content@1" },
          },
        ],
      },
    };
    expect(emitLayoutXml(layout, baseCtx)).toBe(emitLayoutXml(layout, baseCtx));
  });
});

describe("emitLayoutXml — scoped datasourceRef", () => {
  it("throws when allowScoped is false and a scoped ref is encountered", () => {
    expect(() =>
      emitLayoutXml(
        {
          placeholders: {
            "/main": [
              {
                componentHandle: "site-logo@1",
                datasourceRef: { kind: "scoped", slot: "/main/0" },
              },
            ],
          },
        },
        baseCtx
      )
    ).toThrow(/scoped datasourceRef is invalid/);
  });

  it("emits a local: sentinel when allowScoped is true", () => {
    const xml = emitLayoutXml(
      {
        placeholders: {
          "/main": [
            {
              componentHandle: "site-logo@1",
              datasourceRef: { kind: "scoped", slot: "/main/0" },
            },
          ],
        },
      },
      { ...baseCtx, allowScoped: true }
    );
    expect(xml).toContain('ds="local:/main/0"');
  });
});
