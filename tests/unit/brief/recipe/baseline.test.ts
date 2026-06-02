import { describe, expect, it } from "vitest";
import {
  captureBriefTypeBaselinePayload,
  classifyBriefTypeCells,
  hashBriefTypeCells,
  mergeBriefTypeByPolicy,
  SCALAR_CELLS,
} from "../../../../src/brief/recipe/baseline";
import { hashJsonValue } from "../../../../src/sync";
import { BriefTypeRecipeSchema, type BriefTypeRecipe } from "../../../../src/brief/recipe/schema";

const recipe = (input: unknown): BriefTypeRecipe => BriefTypeRecipeSchema.parse(input);

const fullType = (overrides: Partial<BriefTypeRecipe> = {}): BriefTypeRecipe =>
  recipe({
    name: "CreativeBrief",
    label: { "en-us": "Creative Brief" },
    description: "A brief for creative work.",
    icon: "mdi-pencil",
    iconColor: "#3366FF",
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
        label: { "en-us": "Due Date" },
        required: false,
        aiEditable: false,
      },
    ],
    ...overrides,
  });

describe("SCALAR_CELLS", () => {
  // Public contract — locks the scalar tuple so a silent reorder or
  // addition surfaces here.
  it("enumerates the five top-level scalars in declared order", () => {
    expect(SCALAR_CELLS).toEqual(["name", "label", "description", "icon", "iconColor"]);
  });
});

describe("hashBriefTypeCells", () => {
  it("emits one cell per top-level scalar", () => {
    const cells = hashBriefTypeCells(fullType());
    expect(cells.name).toBe(hashJsonValue("CreativeBrief"));
    expect(cells.label).toBe(hashJsonValue({ "en-us": "Creative Brief" }));
    expect(cells.description).toBe(hashJsonValue("A brief for creative work."));
    expect(cells.icon).toBe(hashJsonValue("mdi-pencil"));
    expect(cells.iconColor).toBe(hashJsonValue("#3366FF"));
  });

  it("emits one cell per field, keyed by codename", () => {
    const cells = hashBriefTypeCells(fullType());
    const fields = fullType().fields;
    expect(cells["fields.summary"]).toBe(hashJsonValue(fields[0]));
    expect(cells["fields.dueDate"]).toBe(hashJsonValue(fields[1]));
  });

  it("emits no field cells for a zero-field recipe", () => {
    const empty = fullType({ fields: [] });
    const cells = hashBriefTypeCells(empty);
    expect(Object.keys(cells).filter((p) => p.startsWith("fields."))).toEqual([]);
  });

  // Re-ordering fields without changing their content must NOT shift
  // any cell hash — the cell map is by codename, not index. Position
  // drift is noise (the registry author owns display order on disk,
  // but we don't propagate it as a "change" against the baseline).
  it("does not change cell hashes when only field order shifts", () => {
    const a = fullType();
    const b = fullType({ fields: [a.fields[1], a.fields[0]] });
    expect(hashBriefTypeCells(a)).toEqual(hashBriefTypeCells(b));
  });
});

describe("captureBriefTypeBaselinePayload", () => {
  it("wraps hashBriefTypeCells with the schemaVersion envelope", () => {
    const payload = captureBriefTypeBaselinePayload(fullType());
    expect(payload.schemaVersion).toBe("1");
    expect(payload.cells).toEqual(hashBriefTypeCells(fullType()));
  });
});

describe("classifyBriefTypeCells", () => {
  // No baseline → every cell classifies as first-push.
  it("returns first-push for every cell when baseline is undefined", () => {
    const r = fullType();
    const classifications = classifyBriefTypeCells(r, r, undefined);
    for (const c of Object.values(classifications)) {
      expect(c).toBe("first-push");
    }
  });

  // Identical recipe + tenant + baseline → every cell is recipe-change
  // (the degenerate noop classification documented in classifyHashes).
  it("classifies all-equal cells as recipe-change (degenerate)", () => {
    const r = fullType();
    const baseline = captureBriefTypeBaselinePayload(r);
    const classifications = classifyBriefTypeCells(r, r, baseline);
    for (const c of Object.values(classifications)) {
      expect(c).toBe("recipe-change");
    }
  });

  it("classifies a cms-side edit (recipe = baseline, tenant moved) as cms-edit", () => {
    const desired = fullType();
    const baseline = captureBriefTypeBaselinePayload(desired);
    const tenantMoved = fullType({ description: "Tenant-edited description" });
    const classifications = classifyBriefTypeCells(desired, tenantMoved, baseline);
    expect(classifications.description).toBe("cms-edit");
    expect(classifications.name).toBe("recipe-change");
    expect(classifications["fields.summary"]).toBe("recipe-change");
  });

  it("classifies a recipe-only edit (recipe moved, tenant = baseline) as recipe-change", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const desired = fullType({ description: "Recipe-edited description" });
    const classifications = classifyBriefTypeCells(desired, original, baseline);
    expect(classifications.description).toBe("recipe-change");
  });

  it("classifies both-moved as conflict on the same cell", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const desired = fullType({ description: "Recipe edit" });
    const current = fullType({ description: "Tenant edit" });
    const classifications = classifyBriefTypeCells(desired, current, baseline);
    expect(classifications.description).toBe("conflict");
  });

  // A field added on the recipe side: baseline lacks the cell, so it
  // classifies as first-push for that codename. Other cells unaffected.
  it("classifies a newly added recipe field as first-push", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const desired = fullType({
      fields: [
        ...original.fields,
        {
          type: "RichText",
          name: "audience",
          label: { "en-us": "Audience" },
          required: false,
          aiEditable: true,
        },
      ],
    });
    const classifications = classifyBriefTypeCells(desired, original, baseline);
    expect(classifications["fields.audience"]).toBe("first-push");
    expect(classifications["fields.summary"]).toBe("recipe-change");
  });

  // A field removed on the recipe side: desired hashes the codename's
  // cell against `hashJsonValue(undefined)`, current still has the
  // field; baseline carried the old hash → recipe-change (the recipe
  // author dropped the field, tenant unchanged from baseline).
  it("classifies a recipe-removed field as recipe-change", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const desired = fullType({ fields: [original.fields[0]] });
    const classifications = classifyBriefTypeCells(desired, original, baseline);
    expect(classifications["fields.dueDate"]).toBe("recipe-change");
  });

  // Tenant-only field with no baseline entry → first-push (no ground
  // for classification). The merge will skip it (recipe owns the graph).
  it("classifies a tenant-only field as first-push when baseline lacks it", () => {
    const desired = fullType({ fields: [] });
    const current = fullType();
    const classifications = classifyBriefTypeCells(desired, current, undefined);
    expect(classifications["fields.summary"]).toBe("first-push");
    expect(classifications["fields.dueDate"]).toBe("first-push");
  });
});

describe("mergeBriefTypeByPolicy", () => {
  // recipe-wins on a cms-edit → desired value survives.
  it("recipe-wins keeps desired on cms-edit cells", () => {
    const desired = fullType();
    const baseline = captureBriefTypeBaselinePayload(desired);
    const current = fullType({ description: "Tenant override" });
    const classifications = classifyBriefTypeCells(desired, current, baseline);
    const { merged, policyErrors } = mergeBriefTypeByPolicy(
      desired,
      current,
      classifications,
      "recipe-wins"
    );
    expect(policyErrors).toEqual([]);
    expect(merged.description).toBe("A brief for creative work.");
  });

  // cms-wins on a cms-edit → tenant value survives, no policyError.
  it("cms-wins keeps tenant value on cms-edit cells", () => {
    const desired = fullType();
    const baseline = captureBriefTypeBaselinePayload(desired);
    const current = fullType({ description: "Tenant override" });
    const classifications = classifyBriefTypeCells(desired, current, baseline);
    const { merged, policyErrors } = mergeBriefTypeByPolicy(
      desired,
      current,
      classifications,
      "cms-wins"
    );
    expect(policyErrors).toEqual([]);
    expect(merged.description).toBe("Tenant override");
  });

  // error policy on a cms-edit → policyError surfaced, desired retained
  // (so the caller still has a coherent recipe to log).
  it("error policy surfaces a policyError per cms-edit cell and keeps desired", () => {
    const desired = fullType();
    const baseline = captureBriefTypeBaselinePayload(desired);
    const current = fullType({ description: "Tenant override" });
    const classifications = classifyBriefTypeCells(desired, current, baseline);
    const { merged, policyErrors } = mergeBriefTypeByPolicy(
      desired,
      current,
      classifications,
      "error"
    );
    expect(policyErrors).toHaveLength(1);
    expect(policyErrors[0]?.path).toBe("description");
    expect(policyErrors[0]?.classification).toBe("cms-edit");
    expect(merged.description).toBe("A brief for creative work.");
  });

  // error policy on a conflict → policyError + desired retained.
  it("error policy surfaces a policyError per conflict cell", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const desired = fullType({ description: "Recipe edit" });
    const current = fullType({ description: "Tenant edit" });
    const classifications = classifyBriefTypeCells(desired, current, baseline);
    const { policyErrors } = mergeBriefTypeByPolicy(desired, current, classifications, "error");
    expect(policyErrors).toHaveLength(1);
    expect(policyErrors[0]?.classification).toBe("conflict");
  });

  // recipe-wins on a conflict downgrades to a recipe write.
  it("recipe-wins resolves a conflict to the desired value", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const desired = fullType({ description: "Recipe edit" });
    const current = fullType({ description: "Tenant edit" });
    const classifications = classifyBriefTypeCells(desired, current, baseline);
    const { merged, policyErrors } = mergeBriefTypeByPolicy(
      desired,
      current,
      classifications,
      "recipe-wins"
    );
    expect(policyErrors).toEqual([]);
    expect(merged.description).toBe("Recipe edit");
  });

  // cms-wins on a conflict downgrades to skip (tenant value preserved).
  it("cms-wins resolves a conflict to the tenant value", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const desired = fullType({ description: "Recipe edit" });
    const current = fullType({ description: "Tenant edit" });
    const classifications = classifyBriefTypeCells(desired, current, baseline);
    const { merged, policyErrors } = mergeBriefTypeByPolicy(
      desired,
      current,
      classifications,
      "cms-wins"
    );
    expect(policyErrors).toEqual([]);
    expect(merged.description).toBe("Tenant edit");
  });

  // Tenant-only field → never pulled into the merged recipe, regardless
  // of policy. The recipe author owns the field graph.
  it("does not pull tenant-only fields into the merged recipe", () => {
    const desired = fullType({ fields: [] });
    const current = fullType();
    const classifications = classifyBriefTypeCells(desired, current, undefined);
    for (const policy of ["recipe-wins", "cms-wins", "error"] as const) {
      const { merged } = mergeBriefTypeByPolicy(desired, current, classifications, policy);
      expect(merged.fields).toEqual([]);
    }
  });

  // recipe-change classification → desired always wins (no policy gate
  // — recipe-change means safe-update).
  it("desired wins on recipe-change regardless of policy", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const desired = fullType({ description: "Recipe edit" });
    const classifications = classifyBriefTypeCells(desired, original, baseline);
    for (const policy of ["recipe-wins", "cms-wins", "error"] as const) {
      const { merged, policyErrors } = mergeBriefTypeByPolicy(
        desired,
        original,
        classifications,
        policy
      );
      expect(merged.description).toBe("Recipe edit");
      expect(policyErrors).toEqual([]);
    }
  });

  // A newly added recipe field — first-push classification → desired
  // wins under every policy. The merged recipe carries the new field.
  it("first-push fields land in the merged recipe under every policy", () => {
    const original = fullType();
    const baseline = captureBriefTypeBaselinePayload(original);
    const addedField = {
      type: "RichText" as const,
      name: "audience",
      label: { "en-us": "Audience" },
      required: false,
      aiEditable: true,
    };
    const desired = fullType({ fields: [...original.fields, addedField] });
    const classifications = classifyBriefTypeCells(desired, original, baseline);
    for (const policy of ["recipe-wins", "cms-wins", "error"] as const) {
      const { merged } = mergeBriefTypeByPolicy(desired, original, classifications, policy);
      expect(merged.fields.find((f) => f.name === "audience")).toBeDefined();
    }
  });

  // cms-wins on a cms-edit on a single field — tenant's field
  // definition wins, other fields untouched.
  it("cms-wins on a cms-edited field keeps the tenant's field definition", () => {
    const desired = fullType();
    const baseline = captureBriefTypeBaselinePayload(desired);
    const editedField: (typeof desired.fields)[0] = {
      type: "RichText",
      name: "summary",
      label: { "en-us": "Tenant-edited Summary" },
      required: true,
      aiEditable: true,
    };
    const current = fullType({ fields: [editedField, desired.fields[1]] });
    const classifications = classifyBriefTypeCells(desired, current, baseline);
    expect(classifications["fields.summary"]).toBe("cms-edit");
    const { merged, policyErrors } = mergeBriefTypeByPolicy(
      desired,
      current,
      classifications,
      "cms-wins"
    );
    expect(policyErrors).toEqual([]);
    const mergedSummary = merged.fields.find((f) => f.name === "summary");
    expect(mergedSummary).toEqual(editedField);
  });
});
