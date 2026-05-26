import { describe, expect, it } from "vitest";
import { BriefInstanceRecipeSchema } from "../../../../src/brief/recipe/instance-schema";

const base = {
  name: "Q3 Launch Brief",
  briefTypeName: "CreativeBrief",
};

describe("BriefInstanceRecipeSchema — required fields", () => {
  it("accepts the minimal valid recipe (name + briefTypeName)", () => {
    const parsed = BriefInstanceRecipeSchema.parse(base);
    expect(parsed.name).toBe("Q3 Launch Brief");
    expect(parsed.briefTypeName).toBe("CreativeBrief");
    // fields defaults to {} so the recipe round-trips cleanly when push
    // creates a brief with no field values yet.
    expect(parsed.fields).toEqual({});
  });

  it("rejects missing name", () => {
    expect(() => BriefInstanceRecipeSchema.parse({ briefTypeName: "X" })).toThrow();
  });

  it("rejects missing briefTypeName", () => {
    expect(() => BriefInstanceRecipeSchema.parse({ name: "X" })).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => BriefInstanceRecipeSchema.parse({ ...base, name: "" })).toThrow();
  });

  it("rejects briefTypeName violating the codename pattern", () => {
    // Server requires the codename to match /^[A-Za-z][A-Za-z0-9_]*$/ —
    // a leading digit or a hyphen would 400 at push time, so the schema
    // catches it parse-time.
    expect(() => BriefInstanceRecipeSchema.parse({ ...base, briefTypeName: "1Bad" })).toThrow();
    expect(() =>
      BriefInstanceRecipeSchema.parse({ ...base, briefTypeName: "kebab-case" })
    ).toThrow();
  });
});

describe("BriefInstanceRecipeSchema — optional fields", () => {
  it("accepts a known status", () => {
    const parsed = BriefInstanceRecipeSchema.parse({ ...base, status: "InReview" });
    expect(parsed.status).toBe("InReview");
  });

  it("rejects an unknown status", () => {
    expect(() => BriefInstanceRecipeSchema.parse({ ...base, status: "Frozen" })).toThrow();
  });

  it("accepts locale, isTemplate, and arbitrary field values", () => {
    const parsed = BriefInstanceRecipeSchema.parse({
      ...base,
      locale: "en-us",
      isTemplate: true,
      fields: {
        summary: { type: "RichText", value: { kind: "doc", children: [] } },
        budget: { type: "Budget", value: { amount: 5000, currency: "USD" } },
      },
    });
    expect(parsed.locale).toBe("en-us");
    expect(parsed.isTemplate).toBe(true);
    expect(parsed.fields.summary).toBeDefined();
  });
});
