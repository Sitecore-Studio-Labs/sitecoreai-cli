import { describe, expect, it } from "vitest";
import { AgentRecipeSchema } from "../../../../src/agents/recipe/agent.schema";
import { SkillRecipeSchema } from "../../../../src/agents/recipe/skill.schema";
import { WidgetRecipeSchema } from "../../../../src/agents/recipe/widget.schema";
import { CustomMcpRecipeSchema } from "../../../../src/agents/recipe/custom-mcp.schema";

describe("AgentRecipeSchema", () => {
  it("parses a minimal recipe and applies defaults", () => {
    const r = AgentRecipeSchema.parse({ name: "Researcher" });
    expect(r.name).toBe("Researcher");
    expect(r.tags).toEqual([]);
    expect(r.executionMode).toBe("standard");
    expect(r.tools).toEqual({});
    expect(r.skills).toEqual([]);
    expect(r.output).toEqual({ format: "text" });
  });

  it("rejects a recipe with no name", () => {
    expect(() => AgentRecipeSchema.parse({})).toThrow();
    expect(() => AgentRecipeSchema.parse({ name: "" })).toThrow();
  });
});

describe("SkillRecipeSchema", () => {
  it("requires name/description/content and defaults visibility to team", () => {
    const r = SkillRecipeSchema.parse({ name: "Tone", description: "d", content: "c" });
    expect(r.visibility).toBe("team");
    expect(r.tags).toEqual([]);
  });

  it("rejects a skill missing its content", () => {
    expect(() => SkillRecipeSchema.parse({ name: "Tone", description: "d" })).toThrow();
  });
});

describe("WidgetRecipeSchema", () => {
  it("parses a widget with a spec tree", () => {
    const r = WidgetRecipeSchema.parse({ name: "Scorecard", spec: { root: "root", elements: {} } });
    expect(r.spec.root).toBe("root");
  });
});

describe("CustomMcpRecipeSchema", () => {
  it("rejects a non-URL endpoint", () => {
    expect(() => CustomMcpRecipeSchema.parse({ name: "local", url: "not-a-url" })).toThrow();
  });

  it("accepts a valid URL", () => {
    const r = CustomMcpRecipeSchema.parse({ name: "local", url: "https://example.test/mcp" });
    expect(r.url).toBe("https://example.test/mcp");
  });
});
