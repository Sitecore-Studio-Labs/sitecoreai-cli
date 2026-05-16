import { describe, expect, it } from "vitest";
import { CampaignRecipeSchema } from "../../../../src/campaigns/recipe/schema";

describe("CampaignRecipeSchema", () => {
  it("parses a minimal recipe and applies defaults", () => {
    const recipe = CampaignRecipeSchema.parse({ name: "Spring Launch" });
    expect(recipe.name).toBe("Spring Launch");
    expect(recipe.labels).toEqual([]);
    expect(recipe.deliverables).toEqual([]);
  });

  it("rejects a recipe with no name", () => {
    expect(() => CampaignRecipeSchema.parse({})).toThrow();
    expect(() => CampaignRecipeSchema.parse({ name: "" })).toThrow();
  });

  it("accepts nested deliverables and tasks", () => {
    const recipe = CampaignRecipeSchema.parse({
      name: "Spring Launch",
      description: "Q2 campaign",
      status: "NOT_STARTED",
      startDate: "2026-04-01",
      dueDate: "2026-06-30",
      brandKitId: "kit-1",
      labels: ["q2", "launch"],
      deliverables: [
        {
          name: "Landing page",
          funnelStage: "TOP",
          funnelTactics: ["seo"],
          tasks: [
            { name: "Draft copy", status: "NOT_STARTED" },
            { name: "Review copy", assignee: "auth0|abc" },
          ],
        },
      ],
    });
    expect(recipe.deliverables).toHaveLength(1);
    expect(recipe.deliverables[0].tasks).toHaveLength(2);
    expect(recipe.deliverables[0].tasks[0].name).toBe("Draft copy");
  });

  it("applies defaults for deliverable and task collections", () => {
    const recipe = CampaignRecipeSchema.parse({
      name: "Spring Launch",
      deliverables: [{ name: "Landing page" }],
    });
    expect(recipe.deliverables[0].funnelTactics).toEqual([]);
    expect(recipe.deliverables[0].tasks).toEqual([]);
  });

  it("rejects a deliverable with no name", () => {
    expect(() =>
      CampaignRecipeSchema.parse({ name: "Spring Launch", deliverables: [{}] })
    ).toThrow();
  });

  it("rejects a task with no name", () => {
    expect(() =>
      CampaignRecipeSchema.parse({
        name: "Spring Launch",
        deliverables: [{ name: "Landing page", tasks: [{}] }],
      })
    ).toThrow();
  });
});
