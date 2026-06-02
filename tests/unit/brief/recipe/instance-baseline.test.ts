import { describe, expect, it } from "vitest";
import {
  captureBriefBaselinePayload,
  classifyBriefValue,
  hashBriefValue,
  TOP_LEVEL_ELEMENTS,
} from "../../../../src/brief/recipe/instance-baseline";
import { hashJsonValue } from "../../../../src/sync";
import { BriefInstanceRecipeSchema } from "../../../../src/brief/recipe/instance-schema";

const recipe = (input: unknown) => BriefInstanceRecipeSchema.parse(input);

const fullBrief = () =>
  recipe({
    name: "Q3 Launch Brief",
    briefTypeName: "ProductLaunch",
    locale: "en-us",
    status: "Draft",
    isTemplate: false,
    fields: {
      audience: "Early adopters",
      hook: "Bold, simple, fast.",
      pillars: ["clarity", "speed"],
    },
  });

describe("hashBriefValue", () => {
  // Trivial passthrough — the export exists so kind callers don't
  // import from `@/sync` directly. Verify equivalence.
  it("delegates to hashJsonValue", () => {
    expect(hashBriefValue("v")).toBe(hashJsonValue("v"));
    expect(hashBriefValue({ a: 1 })).toBe(hashJsonValue({ a: 1 }));
    expect(hashBriefValue(undefined)).toBe(hashJsonValue(undefined));
  });
});

describe("TOP_LEVEL_ELEMENTS", () => {
  // Public contract — the registry / orchestrator iterates these to
  // know which top-level cells to hash and classify. Locking the
  // tuple shape so a silent reorder / addition surfaces here.
  it("enumerates the four top-level brief elements in declared order", () => {
    expect(TOP_LEVEL_ELEMENTS).toEqual(["briefTypeName", "locale", "status", "isTemplate"]);
  });
});

describe("captureBriefBaselinePayload", () => {
  it("hashes every top-level element and every field", () => {
    const payload = captureBriefBaselinePayload(fullBrief());
    expect(payload.schemaVersion).toBe("1");
    expect(payload.elements.briefTypeName).toBe(hashBriefValue("ProductLaunch"));
    expect(payload.elements.locale).toBe(hashBriefValue("en-us"));
    expect(payload.elements.status).toBe(hashBriefValue("Draft"));
    expect(payload.elements.isTemplate).toBe(hashBriefValue(false));
    expect(payload.fields.audience).toBe(hashBriefValue("Early adopters"));
    expect(payload.fields.hook).toBe(hashBriefValue("Bold, simple, fast."));
    expect(payload.fields.pillars).toBe(hashBriefValue(["clarity", "speed"]));
  });

  // Optional top-level elements (locale, status, isTemplate) hash as
  // `hashJsonValue(undefined)` when absent — the baseline still records
  // them so a later push that ADDS one classifies as recipe-change
  // (not first-push, which would be misleading).
  it("hashes absent optional top-level elements as undefined-valued cells", () => {
    const sparse = recipe({
      name: "B",
      briefTypeName: "Type",
      fields: {},
    });
    const payload = captureBriefBaselinePayload(sparse);
    expect(payload.elements.locale).toBe(hashBriefValue(undefined));
    expect(payload.elements.status).toBe(hashBriefValue(undefined));
    expect(payload.elements.isTemplate).toBe(hashBriefValue(undefined));
  });

  it("emits an empty fields map when fields is absent or empty", () => {
    const sparse = recipe({
      name: "B",
      briefTypeName: "Type",
      fields: {},
    });
    const payload = captureBriefBaselinePayload(sparse);
    expect(payload.fields).toEqual({});
  });
});

describe("classifyBriefValue", () => {
  // The brief uses the shared classify helper — verify the seam
  // surfaces all four classifications and treats undefined as the
  // first-push sentinel (NOT empty-string).
  it("returns first-push when baseline hash is undefined", () => {
    expect(classifyBriefValue("a", "a", undefined)).toBe("first-push");
  });

  it("returns recipe-change when recipe moves and tenant matches baseline", () => {
    expect(classifyBriefValue("new", "old", "old")).toBe("recipe-change");
  });

  it("returns cms-edit when tenant moves and recipe matches baseline", () => {
    expect(classifyBriefValue("old", "new", "old")).toBe("cms-edit");
  });

  it("returns conflict when both sides move off baseline", () => {
    expect(classifyBriefValue("r-new", "t-new", "old")).toBe("conflict");
  });
});
