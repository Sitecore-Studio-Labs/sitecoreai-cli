import { describe, expect, it } from "vitest";
import { BriefInstanceRecipeSchema } from "../../../../src/brief/recipe/instance-schema";
import { diffBriefInstance } from "../../../../src/brief/recipe/instance-diff";

const recipe = (input: unknown) => BriefInstanceRecipeSchema.parse(input);

const base = {
  name: "Q3 Launch Brief",
  briefTypeName: "CreativeBrief",
};

describe("diffBriefInstance — brief absent", () => {
  it("plans a single create carrying the full recipe in meta", () => {
    const desired = recipe(base);
    const plan = diffBriefInstance(desired, null);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      kind: "create",
      path: "brief",
      after: "Q3 Launch Brief",
    });
    expect(plan.changes[0].meta).toMatchObject({ stage: "instance" });
    expect(plan.changes[0].meta?.recipe).toEqual(desired);
  });

  it("carries fields and status into the create meta payload", () => {
    const desired = recipe({
      ...base,
      status: "Approved",
      fields: { summary: { type: "RichText", value: {} } },
    });
    const plan = diffBriefInstance(desired, null);
    expect(plan.changes[0].meta?.recipe).toEqual(desired);
  });
});

describe("diffBriefInstance — brief present and converged", () => {
  it("emits an all-noop plan for an identical recipe", () => {
    const current = recipe(base);
    const plan = diffBriefInstance(recipe(base), current);
    expect(plan.changes.every((change) => change.kind === "noop")).toBe(true);
    expect(plan.changes.some((change) => change.meta?.stage === "instance")).toBe(false);
  });

  it("reports each compared element exactly once", () => {
    const plan = diffBriefInstance(recipe(base), recipe(base));
    expect(plan.changes.map((change) => change.path)).toEqual([
      "brief.briefTypeName",
      "brief.locale",
      "brief.status",
      "brief.isTemplate",
      "brief.fields",
    ]);
  });
});

describe("diffBriefInstance — brief present with changes", () => {
  it("emits a lead update plus per-element updates when status flips", () => {
    const current = recipe({ ...base, status: "Draft" });
    const desired = recipe({ ...base, status: "Approved" });
    const plan = diffBriefInstance(desired, current);

    expect(plan.changes[0]).toMatchObject({ kind: "update", path: "brief" });
    expect(plan.changes[0].meta).toMatchObject({ stage: "instance" });
    expect(plan.changes[0].meta?.recipe).toEqual(desired);

    const statusChange = plan.changes.find((change) => change.path === "brief.status");
    expect(statusChange).toMatchObject({
      kind: "update",
      before: "Draft",
      after: "Approved",
    });
  });

  it("detects fields changes structurally", () => {
    const current = recipe({ ...base, fields: { a: 1 } });
    const desired = recipe({ ...base, fields: { a: 2 } });
    const plan = diffBriefInstance(desired, current);
    const fieldsChange = plan.changes.find((change) => change.path === "brief.fields");
    expect(fieldsChange?.kind).toBe("update");
  });

  it("surfaces a brief-type repoint attempt as a change (apply will refuse it)", () => {
    // The Brief API has no verified path to change a brief's type — the
    // kind's apply step throws on this. The diff surfaces it so the
    // change is visible in `scai ops brief sync diff` output, not
    // silently dropped.
    const current = recipe({ ...base, briefTypeName: "CreativeBrief" });
    const desired = recipe({ ...base, briefTypeName: "MarketingBrief" });
    const plan = diffBriefInstance(desired, current);
    const typeChange = plan.changes.find((change) => change.path === "brief.briefTypeName");
    expect(typeChange).toMatchObject({
      kind: "update",
      before: "CreativeBrief",
      after: "MarketingBrief",
    });
  });

  it("never emits a stage:instance change when nothing changed", () => {
    const plan = diffBriefInstance(recipe(base), recipe(base));
    expect(plan.changes.filter((change) => change.meta?.stage === "instance")).toHaveLength(0);
  });
});
