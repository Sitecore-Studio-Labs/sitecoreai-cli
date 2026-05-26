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

  it("accepts ISO-8601 date and datetime strings on date fields", () => {
    const recipe = CampaignRecipeSchema.parse({
      name: "Spring Launch",
      startDate: "2026-04-01",
      dueDate: "2026-06-30T17:00:00Z",
      deliverables: [
        {
          name: "Landing page",
          dueDate: "2026-05-15T12:30:00.500+02:00",
          tasks: [{ name: "Draft copy", dueDate: "2026-04-10" }],
        },
      ],
    });
    expect(recipe.startDate).toBe("2026-04-01");
    expect(recipe.deliverables[0].dueDate).toBe("2026-05-15T12:30:00.500+02:00");
  });

  it("rejects malformed dates on date fields", () => {
    expect(() =>
      CampaignRecipeSchema.parse({ name: "Spring Launch", startDate: "April 1" })
    ).toThrow();
    expect(() =>
      CampaignRecipeSchema.parse({ name: "Spring Launch", dueDate: "2026/06/30" })
    ).toThrow();
    expect(() =>
      CampaignRecipeSchema.parse({
        name: "Spring Launch",
        deliverables: [{ name: "L", tasks: [{ name: "t", dueDate: "next friday" }] }],
      })
    ).toThrow();
  });

  it("accepts both confirmed and unobserved enum values on status / funnelStage", () => {
    const recipe = CampaignRecipeSchema.parse({
      name: "Spring Launch",
      status: "NOT_STARTED", // confirmed
      deliverables: [
        {
          name: "Landing page",
          status: "IN_PROGRESS", // unobserved but plausible
          funnelStage: "TOP", // confirmed
          tasks: [
            { name: "Draft copy", status: "DONE" }, // unobserved
            { name: "Review copy", priority: "HIGH" }, // priority has no observed enum
          ],
        },
        {
          name: "Email blast",
          funnelStage: "MIDDLE", // unobserved
        },
      ],
    });
    expect(recipe.status).toBe("NOT_STARTED");
    expect(recipe.deliverables[0].status).toBe("IN_PROGRESS");
    expect(recipe.deliverables[0].funnelStage).toBe("TOP");
    expect(recipe.deliverables[1].funnelStage).toBe("MIDDLE");
    expect(recipe.deliverables[0].tasks[0].status).toBe("DONE");
  });

  it("still rejects non-string values on enum-typed fields", () => {
    expect(() => CampaignRecipeSchema.parse({ name: "Spring Launch", status: 42 })).toThrow();
    expect(() =>
      CampaignRecipeSchema.parse({
        name: "Spring Launch",
        deliverables: [{ name: "L", funnelStage: ["TOP"] }],
      })
    ).toThrow();
  });
});
