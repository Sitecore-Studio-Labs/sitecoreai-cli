import { describe, expect, it } from "vitest";
import {
  computeContentHash,
  extractPersonalizationRefs,
  extractRenderingDatasources,
  isPageDesignField,
  isRenderingField,
} from "../../../../src/hygiene/tasks/shared";

describe("isRenderingField", () => {
  it("flags __Renderings + __Final Renderings", () => {
    expect(isRenderingField("__Renderings")).toBe(true);
    expect(isRenderingField("__Final Renderings")).toBe(true);
  });

  it("does not flag arbitrary fields", () => {
    expect(isRenderingField("Title")).toBe(false);
    expect(isRenderingField("__Lock")).toBe(false);
  });
});

describe("isPageDesignField", () => {
  it("flags __Final Page Design + __Page Design", () => {
    expect(isPageDesignField("__Final Page Design")).toBe(true);
    expect(isPageDesignField("__Page Design")).toBe(true);
  });

  it("does not flag arbitrary fields", () => {
    expect(isPageDesignField("Title")).toBe(false);
    expect(isPageDesignField("__Renderings")).toBe(false);
  });
});

describe("extractRenderingDatasources", () => {
  it("returns empty for empty input", () => {
    expect(extractRenderingDatasources("")).toEqual([]);
  });

  it("extracts `ds` attribute from <r> elements", () => {
    const xml = '<r uid="{a}" id="{rend1}" ds="/sitecore/content/Home/Data/Article" par="x=1" />';
    expect(extractRenderingDatasources(xml)).toEqual([
      { datasource: "/sitecore/content/Home/Data/Article", renderingId: "{rend1}" },
    ]);
  });

  it("extracts s:ds in preference to bare ds", () => {
    const xml = '<r s:id="{rend1}" s:ds="{abc-123}" />';
    const result = extractRenderingDatasources(xml);
    expect(result).toEqual([{ datasource: "{abc-123}", renderingId: "{rend1}" }]);
  });

  it("handles multiple <r> elements", () => {
    const xml = '<r ds="/path/A"/><r ds="/path/B" id="{r2}"/><r ds=""/>';
    const result = extractRenderingDatasources(xml);
    expect(result).toEqual([
      { datasource: "/path/A", renderingId: null },
      { datasource: "/path/B", renderingId: "{r2}" },
    ]);
  });

  it("skips elements with no ds attribute", () => {
    const xml = '<r id="{r1}" par="x=1" />';
    expect(extractRenderingDatasources(xml)).toEqual([]);
  });
});

describe("extractPersonalizationRefs", () => {
  it("returns empty for empty input", () => {
    expect(extractPersonalizationRefs("")).toEqual([]);
  });

  it("extracts datasource from <action> elements", () => {
    const xml =
      '<r ds="/A"><rules><rule><actions><action id="{actionTmpl}" datasource="{variant-1}"/></actions></rule></rules></r>';
    expect(extractPersonalizationRefs(xml)).toEqual(["{variant-1}"]);
  });

  it("extracts rule-set ids from <rules s:set>", () => {
    const xml = '<r><rules s:set="{ruleset-1}"></rules></r>';
    expect(extractPersonalizationRefs(xml)).toEqual(["{ruleset-1}"]);
  });

  it("captures both action datasources and rule-set ids in one pass", () => {
    const xml =
      '<r><rules s:set="{ruleset-1}"><rule><actions><action datasource="{variant-1}"/><action datasource="{variant-2}"/></actions></rule></rules></r>';
    const result = extractPersonalizationRefs(xml);
    expect(result).toContain("{ruleset-1}");
    expect(result).toContain("{variant-1}");
    expect(result).toContain("{variant-2}");
    expect(result).toHaveLength(3);
  });
});

describe("computeContentHash", () => {
  it("produces a stable 16-char hex hash", async () => {
    const fields = [
      { name: "Title", value: "Hello" },
      { name: "Body", value: "World" },
    ];
    const h = await computeContentHash(fields);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces the same hash regardless of field order", async () => {
    const a = await computeContentHash([
      { name: "Title", value: "Hello" },
      { name: "Body", value: "World" },
    ]);
    const b = await computeContentHash([
      { name: "Body", value: "World" },
      { name: "Title", value: "Hello" },
    ]);
    expect(a).toBe(b);
  });

  it("excludes __-prefixed system fields by default", async () => {
    const a = await computeContentHash([
      { name: "Title", value: "Hello" },
      { name: "__Created", value: "2026-01-01" },
    ]);
    const b = await computeContentHash([
      { name: "Title", value: "Hello" },
      { name: "__Created", value: "2026-12-31" },
    ]);
    expect(a).toBe(b);
  });

  it("includes __-prefixed fields when includeSystem is true", async () => {
    const a = await computeContentHash(
      [
        { name: "Title", value: "Hello" },
        { name: "__Created", value: "2026-01-01" },
      ],
      { includeSystem: true }
    );
    const b = await computeContentHash(
      [
        { name: "Title", value: "Hello" },
        { name: "__Created", value: "2026-12-31" },
      ],
      { includeSystem: true }
    );
    expect(a).not.toBe(b);
  });

  it("trims whitespace when comparing values", async () => {
    const a = await computeContentHash([{ name: "Title", value: "Hello" }]);
    const b = await computeContentHash([{ name: "Title", value: "  Hello  " }]);
    expect(a).toBe(b);
  });

  it("excludes empty fields from the hash input", async () => {
    const a = await computeContentHash([
      { name: "Title", value: "Hello" },
      { name: "Body", value: "" },
    ]);
    const b = await computeContentHash([{ name: "Title", value: "Hello" }]);
    expect(a).toBe(b);
  });

  // Regression: items with zero authored content used to all hash to
  // sha256("") = "e3b0c44298fc1c14", which made `audit duplicates`
  // bucket every blank item into one giant false-positive group.
  // Empty-content now returns "" so the duplicates audit's
  // `if (!hash) continue;` guard skips them entirely.
  it("returns empty string when there's no authored content (no false-positive duplicate bucket)", async () => {
    const empty = await computeContentHash([]);
    const whitespace = await computeContentHash([{ name: "Title", value: "   " }]);
    const systemOnly = await computeContentHash([
      { name: "__Created", value: "2026-01-01" },
      { name: "__Updated", value: "2026-12-31" },
    ]);
    expect(empty).toBe("");
    expect(whitespace).toBe("");
    expect(systemOnly).toBe("");
  });
});
