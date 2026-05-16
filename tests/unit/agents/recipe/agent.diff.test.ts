import { describe, expect, it } from "vitest";
import { AgentRecipeSchema } from "../../../../src/agents/recipe/agent.schema";
import { diffAgent } from "../../../../src/agents/recipe/agent.diff";

const recipe = (input: unknown) => AgentRecipeSchema.parse(input);

describe("diffAgent — agent absent", () => {
  it("plans a single create change when current is null", () => {
    const plan = diffAgent(recipe({ name: "Researcher" }), null);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "agent.Researcher" });
  });

  it("carries the recipe on the change's meta for apply", () => {
    const plan = diffAgent(recipe({ name: "Researcher", prompt: "do research" }), null);
    expect(plan.changes[0].meta?.recipe).toMatchObject({
      name: "Researcher",
      prompt: "do research",
    });
  });
});

describe("diffAgent — agent present", () => {
  it("is a noop when desired equals current", () => {
    const current = recipe({ name: "Researcher", prompt: "p", tags: ["x"] });
    const plan = diffAgent(recipe({ name: "Researcher", prompt: "p", tags: ["x"] }), current);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].kind).toBe("noop");
  });

  it("plans an update with before/after when a field differs", () => {
    const current = recipe({ name: "Researcher", prompt: "old" });
    const plan = diffAgent(recipe({ name: "Researcher", prompt: "new" }), current);
    expect(plan.changes[0]).toMatchObject({ kind: "update", path: "agent.Researcher" });
    expect((plan.changes[0].before as { prompt?: string }).prompt).toBe("old");
    expect((plan.changes[0].after as { prompt?: string }).prompt).toBe("new");
  });

  it("detects a tools-toggle change", () => {
    const current = recipe({ name: "R", tools: { enableWebSearch: false } });
    const plan = diffAgent(recipe({ name: "R", tools: { enableWebSearch: true } }), current);
    expect(plan.changes[0].kind).toBe("update");
  });
});
