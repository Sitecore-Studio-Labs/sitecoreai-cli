import { describe, expect, it } from "vitest";
import { diffCreateOnly } from "../../../../src/agents/recipe/converge";

describe("diffCreateOnly", () => {
  it("plans a create when current is null", () => {
    const plan = diffCreateOnly("skill", "Tone of voice", { name: "Tone of voice" }, null);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "skill.Tone of voice" });
    expect(plan.changes[0].meta?.recipe).toMatchObject({ name: "Tone of voice" });
  });

  it("is a noop when the resource exists — create-only kinds never update", () => {
    const plan = diffCreateOnly(
      "widget",
      "Scorecard",
      { name: "Scorecard", version: 2 },
      { name: "Scorecard", version: 1 }
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].kind).toBe("noop");
  });

  it("labels the path with the kind", () => {
    const plan = diffCreateOnly("custom-mcp", "local", { name: "local" }, null);
    expect(plan.changes[0].path).toBe("custom-mcp.local");
  });
});
