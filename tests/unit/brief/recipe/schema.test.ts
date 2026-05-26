import { describe, expect, it } from "vitest";
import { BriefTypeRecipeSchema } from "../../../../src/brief/recipe/schema";

const baseRecipe = {
  name: "CreativeBrief",
  label: { "en-us": "Creative Brief" },
  description: "A brief for creative work.",
  icon: "mdi-pencil",
  iconColor: "#3366FF",
};

describe("BriefTypeRecipeSchema", () => {
  it("parses a minimal recipe and defaults fields to an empty list", () => {
    const recipe = BriefTypeRecipeSchema.parse(baseRecipe);
    expect(recipe.name).toBe("CreativeBrief");
    expect(recipe.fields).toEqual([]);
  });

  it("rejects a recipe with no name", () => {
    const { name: _name, ...withoutName } = baseRecipe;
    expect(() => BriefTypeRecipeSchema.parse(withoutName)).toThrow();
  });

  it("rejects a name that does not match the codename pattern", () => {
    expect(() => BriefTypeRecipeSchema.parse({ ...baseRecipe, name: "1Bad" })).toThrow();
    expect(() => BriefTypeRecipeSchema.parse({ ...baseRecipe, name: "has space" })).toThrow();
    expect(() => BriefTypeRecipeSchema.parse({ ...baseRecipe, name: "" })).toThrow();
  });

  it("rejects a recipe missing required label/description/icon", () => {
    expect(() => BriefTypeRecipeSchema.parse({ name: "X" })).toThrow();
  });

  it("accepts fields of every discriminated kind", () => {
    const recipe = BriefTypeRecipeSchema.parse({
      ...baseRecipe,
      fields: [
        {
          type: "RichText",
          name: "summary",
          label: { "en-us": "Summary" },
          required: true,
          aiEditable: true,
        },
        {
          type: "DateTime",
          name: "dueDate",
          label: { "en-us": "Due" },
          required: false,
          aiEditable: false,
        },
        {
          type: "Timeline",
          name: "schedule",
          label: { "en-us": "Schedule" },
          required: false,
          aiEditable: false,
          calculation: 0,
          skipHolidays: true,
          skipWeekend: true,
          timezone: "America/New_York",
        },
        {
          type: "Budget",
          name: "budget",
          label: { "en-us": "Budget" },
          required: false,
          aiEditable: false,
          currencies: ["USD", "EUR"],
        },
      ],
    });
    expect(recipe.fields).toHaveLength(4);
    expect(recipe.fields.map((field) => field.type)).toEqual([
      "RichText",
      "DateTime",
      "Timeline",
      "Budget",
    ]);
  });

  it("rejects a field with an unknown type", () => {
    expect(() =>
      BriefTypeRecipeSchema.parse({
        ...baseRecipe,
        fields: [{ type: "Unknown", name: "x", label: {}, required: false, aiEditable: false }],
      })
    ).toThrow();
  });

  it("rejects a Budget field missing its currencies array", () => {
    expect(() =>
      BriefTypeRecipeSchema.parse({
        ...baseRecipe,
        fields: [{ type: "Budget", name: "b", label: {}, required: false, aiEditable: false }],
      })
    ).toThrow();
  });

  it("rejects Budget currencies that aren't ISO-4217 3-letter codes", () => {
    const make = (currencies: string[]) =>
      BriefTypeRecipeSchema.parse({
        ...baseRecipe,
        fields: [
          {
            type: "Budget",
            name: "budget",
            label: {},
            required: false,
            aiEditable: false,
            currencies,
          },
        ],
      });
    expect(() => make(["usd"])).toThrow(); // lowercase
    expect(() => make(["DOLLARS"])).toThrow(); // wrong length
    expect(() => make(["US"])).toThrow(); // too short
    expect(() => make(["US$"])).toThrow(); // non-letter
    expect(() => make(["USD", "EUR", "GBP"])).not.toThrow();
  });
});
