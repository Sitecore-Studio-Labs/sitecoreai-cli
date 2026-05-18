import { describe, expect, it } from "vitest";
import { recipeSetNeedsRoots, resolveRecipeRoots } from "../../../../src/recipe/tasks/shared";

describe("recipeSetNeedsRoots", () => {
  it("is false for a workflow-only set", () => {
    expect(recipeSetNeedsRoots([{ kind: "workflow" }])).toBe(false);
  });

  it("is false for a workflow + webhook-authorization set", () => {
    expect(recipeSetNeedsRoots([{ kind: "workflow" }, { kind: "webhook-authorization" }])).toBe(
      false
    );
  });

  it("is false for an empty set (IR-only push)", () => {
    expect(recipeSetNeedsRoots([])).toBe(false);
  });

  it("is true when the set has a component-template recipe", () => {
    expect(recipeSetNeedsRoots([{ kind: "component-template" }])).toBe(true);
  });

  it("is true for a set mixing a rootless and a root-needing kind", () => {
    expect(recipeSetNeedsRoots([{ kind: "workflow" }, { kind: "component-template" }])).toBe(true);
  });
});

describe("resolveRecipeRoots", () => {
  const envWithRoots = { templatesRoot: "/t", renderingsRoot: "/r" };

  it("returns configured roots from the env profile", () => {
    expect(resolveRecipeRoots({}, envWithRoots, "sandbox")).toEqual({
      templatesRoot: "/t",
      renderingsRoot: "/r",
    });
  });

  it("prefers CLI-flag overrides over the env profile", () => {
    expect(resolveRecipeRoots({ templatesRoot: "/flag-t" }, envWithRoots, "sandbox")).toEqual({
      templatesRoot: "/flag-t",
      renderingsRoot: "/r",
    });
  });

  it("throws INPUT_INVALID when required and a root is missing", () => {
    expect(() => resolveRecipeRoots({}, {}, "sandbox")).toThrowError(/Recipe parent path missing/);
  });

  it("does not throw when not required — missing roots resolve to empty strings", () => {
    expect(resolveRecipeRoots({}, {}, "sandbox", false)).toEqual({
      templatesRoot: "",
      renderingsRoot: "",
    });
  });

  it("still passes through configured roots when not required", () => {
    expect(resolveRecipeRoots({}, envWithRoots, "sandbox", false)).toEqual({
      templatesRoot: "/t",
      renderingsRoot: "/r",
    });
  });
});
