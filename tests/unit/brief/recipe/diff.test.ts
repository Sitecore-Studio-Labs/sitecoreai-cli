import { describe, expect, it } from "vitest";
import { BriefTypeRecipeSchema } from "../../../../src/brief/recipe/schema";
import { diffBriefType } from "../../../../src/brief/recipe/diff";

const recipe = (input: unknown) => BriefTypeRecipeSchema.parse(input);

const base = {
  name: "CreativeBrief",
  label: { "en-us": "Creative Brief" },
  description: "A brief for creative work.",
  icon: "mdi-pencil",
  iconColor: "#3366FF",
};

const richField = (name: string, required = false) => ({
  type: "RichText" as const,
  name,
  label: { "en-us": name },
  required,
  aiEditable: true,
});

describe("diffBriefType — brief type absent", () => {
  it("plans a single create carrying the full recipe in meta", () => {
    const desired = recipe(base);
    const plan = diffBriefType(desired, null);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      kind: "create",
      path: "briefType",
      after: "CreativeBrief",
    });
    expect(plan.changes[0].meta).toMatchObject({ stage: "type" });
    expect(plan.changes[0].meta?.recipe).toEqual(desired);
  });

  it("carries fields into the create meta payload", () => {
    const desired = recipe({ ...base, fields: [richField("summary")] });
    const plan = diffBriefType(desired, null);
    expect(plan.changes[0].meta?.recipe).toEqual(desired);
  });
});

describe("diffBriefType — brief type present and converged", () => {
  it("emits an all-noop plan for an identical type", () => {
    const current = recipe(base);
    const plan = diffBriefType(recipe(base), current);
    expect(plan.changes.every((change) => change.kind === "noop")).toBe(true);
    expect(plan.changes.some((change) => change.meta?.stage === "type")).toBe(false);
  });

  it("reports each top-level element as a noop change", () => {
    const plan = diffBriefType(recipe(base), recipe(base));
    expect(plan.changes.map((change) => change.path)).toEqual([
      "briefType.label",
      "briefType.description",
      "briefType.icon",
      "briefType.iconColor",
      "briefType.fields",
    ]);
  });
});

describe("diffBriefType — brief type present with changes", () => {
  it("emits a lead whole-record update plus per-element updates", () => {
    const current = recipe(base);
    const desired = recipe({ ...base, description: "Changed." });
    const plan = diffBriefType(desired, current);

    expect(plan.changes[0]).toMatchObject({ kind: "update", path: "briefType" });
    expect(plan.changes[0].meta).toMatchObject({ stage: "type" });
    expect(plan.changes[0].meta?.recipe).toEqual(desired);

    const descChange = plan.changes.find((change) => change.path === "briefType.description");
    expect(descChange).toMatchObject({
      kind: "update",
      before: "A brief for creative work.",
      after: "Changed.",
    });
  });

  it("marks unchanged elements as noop while changed ones update", () => {
    const plan = diffBriefType(recipe({ ...base, icon: "mdi-star" }), recipe(base));
    const byPath = Object.fromEntries(plan.changes.map((change) => [change.path, change.kind]));
    expect(byPath["briefType.icon"]).toBe("update");
    expect(byPath["briefType.label"]).toBe("noop");
    expect(byPath["briefType.description"]).toBe("noop");
  });

  it("diffs the fields array structurally", () => {
    const current = recipe({ ...base, fields: [richField("summary")] });

    const same = diffBriefType(recipe({ ...base, fields: [richField("summary")] }), current);
    expect(same.changes.find((change) => change.path === "briefType.fields")?.kind).toBe("noop");

    const changed = diffBriefType(
      recipe({ ...base, fields: [richField("summary"), richField("goals")] }),
      current
    );
    const fieldsChange = changed.changes.find((change) => change.path === "briefType.fields");
    expect(fieldsChange?.kind).toBe("update");
  });

  it("detects a field property change as a fields update", () => {
    const current = recipe({ ...base, fields: [richField("summary", false)] });
    const desired = recipe({ ...base, fields: [richField("summary", true)] });
    const plan = diffBriefType(desired, current);
    expect(plan.changes.find((change) => change.path === "briefType.fields")?.kind).toBe("update");
  });

  it("never emits a stage:type change when nothing changed", () => {
    const plan = diffBriefType(recipe(base), recipe(base));
    expect(plan.changes.filter((change) => change.meta?.stage === "type")).toHaveLength(0);
  });
});
