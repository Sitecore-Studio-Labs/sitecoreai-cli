import { describe, expect, it } from "vitest";
import {
  captureBrandBaselinePayload,
  classifyBrandCells,
  hashBrandCells,
  mergeBrandByPolicy,
} from "../../../../src/brand/recipe/baseline";
import { hashJsonValue } from "../../../../src/sync";
import { BrandKitRecipeSchema } from "../../../../src/brand/recipe/schema";

const recipe = (input: unknown) => BrandKitRecipeSchema.parse(input);

const fullKit = () =>
  recipe({
    name: "Acme",
    description: "Vehicle brand",
    industry: "Automotive",
    documents: [],
    sections: {
      "Brand Context": {
        Mission: "Build durable vehicles",
        // `array` fields are object-shaped on the wire — `{name}` per
        // entry, not bare strings.
        Values: [{ name: "Quality" }, { name: "Reliability" }],
      },
      "Tone of Voice": {
        Voice: "Confident",
      },
    },
  });

describe("hashBrandCells", () => {
  it("does NOT emit cells for description / industry (Sitecore-owned kit metadata)", () => {
    // description + industry are written once at createBrandKit time and
    // never by the converge loop; the registry renders them read-only and
    // omits them from the pushed recipe. Including them in the merge made
    // `desired` (undefined) perpetually diverge from `current` (live
    // value), blocking every error-policy push. They stay out of the diff.
    const cells = hashBrandCells(fullKit());
    expect(cells["kit.description"]).toBeUndefined();
    expect(cells["kit.industry"]).toBeUndefined();
  });

  it("emits one cell per section × field", () => {
    const cells = hashBrandCells(fullKit());
    expect(cells["sections.Brand Context.Mission"]).toBe(hashJsonValue("Build durable vehicles"));
    expect(cells["sections.Brand Context.Values"]).toBe(
      hashJsonValue([{ name: "Quality" }, { name: "Reliability" }])
    );
    expect(cells["sections.Tone of Voice.Voice"]).toBe(hashJsonValue("Confident"));
  });

  it("does NOT emit cells for documents (input-only ingestion fuel)", () => {
    const withDocs = recipe({
      name: "Acme",
      documents: [{ url: "https://x.test/a.pdf" }],
      sections: {},
    });
    const cells = hashBrandCells(withDocs);
    const paths = Object.keys(cells);
    expect(paths.find((p) => p.includes("documents"))).toBeUndefined();
  });

  it("handles an empty sections graph (degenerate case)", () => {
    const empty = recipe({ name: "Acme", documents: [], sections: {} });
    const cells = hashBrandCells(empty);
    // No sections, and kit metadata is no longer a merge cell → no cells.
    expect(Object.keys(cells)).toEqual([]);
  });
});

describe("captureBrandBaselinePayload", () => {
  it("wraps hashBrandCells with the schemaVersion envelope", () => {
    const payload = captureBrandBaselinePayload(fullKit());
    expect(payload.schemaVersion).toBe("1");
    expect(payload.cells).toEqual(hashBrandCells(fullKit()));
  });
});

describe("classifyBrandCells", () => {
  // Two identical recipes against an undefined baseline — every cell
  // classifies as first-push (no baseline means no three-way ground).
  it("returns first-push for every cell when baseline is undefined", () => {
    const r = fullKit();
    const classifications = classifyBrandCells(r, r, undefined);
    for (const c of Object.values(classifications)) {
      expect(c).toBe("first-push");
    }
  });

  // Identical recipe + tenant + baseline → every cell is recipe-change
  // (the degenerate noop classification documented in classifyHashes).
  it("classifies all-equal cells as recipe-change (degenerate)", () => {
    const r = fullKit();
    const baseline = captureBrandBaselinePayload(r);
    const classifications = classifyBrandCells(r, r, baseline);
    for (const c of Object.values(classifications)) {
      expect(c).toBe("recipe-change");
    }
  });

  it("classifies a cms-side edit (recipe = baseline, tenant moved) as cms-edit", () => {
    const desired = fullKit();
    const baseline = captureBrandBaselinePayload(desired);
    const tenantMoved = recipe({
      ...desired,
      sections: {
        ...desired.sections,
        "Brand Context": {
          ...desired.sections["Brand Context"],
          Mission: "Tenant-edited mission",
        },
      },
    });
    const classifications = classifyBrandCells(desired, tenantMoved, baseline);
    expect(classifications["sections.Brand Context.Mission"]).toBe("cms-edit");
    // Other cells unchanged.
    expect(classifications["sections.Brand Context.Values"]).toBe("recipe-change");
    // Kit metadata never classifies — it's out of the merge surface.
    expect(classifications["kit.description"]).toBeUndefined();
  });

  it("classifies a recipe-only edit (recipe moved, tenant = baseline) as recipe-change", () => {
    const original = fullKit();
    const baseline = captureBrandBaselinePayload(original);
    const desired = recipe({
      ...original,
      sections: {
        ...original.sections,
        "Tone of Voice": { Voice: "Recipe-edited voice" },
      },
    });
    const classifications = classifyBrandCells(desired, original, baseline);
    expect(classifications["sections.Tone of Voice.Voice"]).toBe("recipe-change");
  });

  it("classifies both-moved as conflict", () => {
    const original = fullKit();
    const baseline = captureBrandBaselinePayload(original);
    const desired = recipe({
      ...original,
      sections: { ...original.sections, "Tone of Voice": { Voice: "Recipe edit" } },
    });
    const current = recipe({
      ...original,
      sections: { ...original.sections, "Tone of Voice": { Voice: "Tenant edit" } },
    });
    const classifications = classifyBrandCells(desired, current, baseline);
    expect(classifications["sections.Tone of Voice.Voice"]).toBe("conflict");
  });

  // Tenant has a cell the recipe doesn't (a section field added in
  // the CMS). The recipe-side hash is hashJsonValue(undefined); if
  // baseline also lacks that cell it's first-push.
  it("treats tenant-only cells as first-push when baseline lacks them too", () => {
    const desired = recipe({
      name: "Acme",
      documents: [],
      sections: {},
    });
    const current = recipe({
      name: "Acme",
      documents: [],
      sections: { "Brand Context": { Mission: "Tenant-introduced" } },
    });
    const classifications = classifyBrandCells(desired, current, undefined);
    expect(classifications["sections.Brand Context.Mission"]).toBe("first-push");
  });
});

describe("mergeBrandByPolicy", () => {
  // recipe-wins on a cms-edit → desired value survives.
  it("recipe-wins keeps desired on cms-edit cells", () => {
    const desired = fullKit();
    const baseline = captureBrandBaselinePayload(desired);
    const current = recipe({
      ...desired,
      sections: {
        ...desired.sections,
        "Brand Context": {
          ...desired.sections["Brand Context"],
          Mission: "Tenant override",
        },
      },
    });
    const classifications = classifyBrandCells(desired, current, baseline);
    const { merged, policyErrors } = mergeBrandByPolicy(
      desired,
      current,
      classifications,
      "recipe-wins"
    );
    expect(policyErrors).toEqual([]);
    expect(merged.sections["Brand Context"].Mission).toBe("Build durable vehicles");
  });

  // cms-wins on a cms-edit → tenant value survives.
  it("cms-wins keeps tenant value on cms-edit cells", () => {
    const desired = fullKit();
    const baseline = captureBrandBaselinePayload(desired);
    const current = recipe({
      ...desired,
      sections: {
        ...desired.sections,
        "Brand Context": {
          ...desired.sections["Brand Context"],
          Mission: "Tenant override",
        },
      },
    });
    const classifications = classifyBrandCells(desired, current, baseline);
    const { merged } = mergeBrandByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.sections["Brand Context"].Mission).toBe("Tenant override");
  });

  // Regression: the merged recipe used to omit `logo`, so on the UPDATE
  // path diffBrandKit saw `desired.logo === undefined` and never PATCHed a
  // changed logo to Sitecore (CREATE worked because it skips the merge).
  // logo is outside the cell-classification — recipe-author intent carries
  // through verbatim under every policy.
  it("carries the recipe logo through the merge on update", () => {
    const desired = recipe({
      name: "Acme",
      description: "Vehicle brand",
      industry: "Automotive",
      documents: [],
      logo: "https://durable.example/new-logo.png",
      sections: { "Brand Context": { Mission: "Build durable vehicles" } },
    });
    const baseline = captureBrandBaselinePayload(desired);
    // Tenant still carries the OLD logo URL.
    const current = recipe({
      ...desired,
      logo: "https://durable.example/old-logo.png",
    });
    const classifications = classifyBrandCells(desired, current, baseline);
    for (const policy of ["recipe-wins", "cms-wins", "error"] as const) {
      const { merged } = mergeBrandByPolicy(desired, current, classifications, policy);
      expect(merged.logo).toBe("https://durable.example/new-logo.png");
    }
  });

  // error policy on a cms-edit → policyError surfaced + desired
  // retained (so the caller still has a coherent recipe to log).
  it("error policy surfaces a policyError per cms-edit cell and keeps desired", () => {
    const desired = fullKit();
    const baseline = captureBrandBaselinePayload(desired);
    const current = recipe({
      ...desired,
      sections: {
        ...desired.sections,
        "Brand Context": {
          ...desired.sections["Brand Context"],
          Mission: "Tenant override",
        },
      },
    });
    const classifications = classifyBrandCells(desired, current, baseline);
    const { merged, policyErrors } = mergeBrandByPolicy(desired, current, classifications, "error");
    expect(policyErrors).toHaveLength(1);
    expect(policyErrors[0]?.path).toBe("sections.Brand Context.Mission");
    expect(policyErrors[0]?.classification).toBe("cms-edit");
    expect(merged.sections["Brand Context"].Mission).toBe("Build durable vehicles");
  });

  // Regression: a pushed recipe omits description/industry (registry
  // renders them read-only), but the live kit always carries them. This
  // must NOT surface a policyError under the strict `error` policy —
  // otherwise every push of otherwise-unchanged content is blocked.
  it("does not block an error-policy push when only Sitecore-owned metadata differs", () => {
    const desired = recipe({
      name: "Acme",
      documents: [],
      sections: { "Tone of Voice": { Voice: "Confident" } },
    });
    const baseline = captureBrandBaselinePayload(desired);
    // Live kit (as readCurrent builds it) carries description + industry.
    const current = recipe({
      name: "Acme",
      description: "Sitecore-owned description",
      industry: "Automotive",
      documents: [],
      sections: { "Tone of Voice": { Voice: "Confident" } },
    });
    const classifications = classifyBrandCells(desired, current, baseline);
    const { policyErrors } = mergeBrandByPolicy(desired, current, classifications, "error");
    expect(policyErrors).toEqual([]);
  });

  // Regression: a baseline captured under the OLD hash still carries
  // kit.description / kit.industry cells. Stripping them makes a stale
  // baseline behave like a freshly-captured one, so an error-policy push
  // isn't blocked on phantom conflicts — no re-baseline required.
  it("strips retired kit-metadata cells from a stale baseline (no phantom conflict)", () => {
    const desired = recipe({
      name: "Acme",
      documents: [],
      sections: { "Tone of Voice": { Voice: "Confident" } },
    });
    const current = recipe({
      name: "Acme",
      description: "Sitecore-owned description",
      industry: "Automotive",
      documents: [],
      sections: { "Tone of Voice": { Voice: "Confident" } },
    });
    // A stale baseline: current cells PLUS the legacy kit.* cells the
    // old hashBrandCells used to emit.
    const staleBaseline = {
      schemaVersion: "1" as const,
      cells: {
        ...captureBrandBaselinePayload(desired).cells,
        "kit.description": hashJsonValue("Older description"),
        "kit.industry": hashJsonValue("Older industry"),
      },
    };
    const classifications = classifyBrandCells(desired, current, staleBaseline);
    expect(classifications["kit.description"]).toBeUndefined();
    expect(classifications["kit.industry"]).toBeUndefined();
    const { policyErrors } = mergeBrandByPolicy(desired, current, classifications, "error");
    expect(policyErrors).toEqual([]);
  });

  // The merged recipe MUST NOT contain a section the recipe didn't
  // declare (the recipe owns the section graph) — even when tenant
  // has one and cms-wins is in force.
  it("does not pull tenant-only sections into the merged recipe", () => {
    const desired = recipe({
      name: "Acme",
      documents: [],
      sections: { "Brand Context": { Mission: "Recipe mission" } },
    });
    const current = recipe({
      name: "Acme",
      documents: [],
      sections: {
        "Brand Context": { Mission: "Recipe mission" },
        "Tone of Voice": { Voice: "Tenant-only voice" },
      },
    });
    const classifications = classifyBrandCells(desired, current, undefined);
    const { merged } = mergeBrandByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.sections["Tone of Voice"]).toBeUndefined();
    expect(merged.sections["Brand Context"]).toBeDefined();
  });

  // Tenant-only field within a recipe-declared section — also skipped.
  // The recipe owns BOTH the section graph AND its field set.
  it("does not pull tenant-only fields within a recipe-declared section", () => {
    const desired = recipe({
      name: "Acme",
      documents: [],
      sections: { "Brand Context": { Mission: "Recipe-set" } },
    });
    const current = recipe({
      name: "Acme",
      documents: [],
      sections: {
        "Brand Context": {
          Mission: "Recipe-set",
          ExtraField: "Tenant-only",
        },
      },
    });
    const classifications = classifyBrandCells(desired, current, undefined);
    const { merged } = mergeBrandByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.sections["Brand Context"]).toEqual({ Mission: "Recipe-set" });
  });

  // Preserves the desired recipe's documents + name on merge — they
  // don't participate in cell classification, so they pass through.
  it("preserves the desired recipe's name + documents on merge", () => {
    const desired = recipe({
      name: "Acme",
      documents: [{ url: "https://x.test/a.pdf" }],
      sections: { "Brand Context": { Mission: "Recipe" } },
    });
    const current = recipe({
      name: "Acme",
      documents: [],
      sections: { "Brand Context": { Mission: "Tenant" } },
    });
    const classifications = classifyBrandCells(desired, current, undefined);
    const { merged } = mergeBrandByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.name).toBe("Acme");
    // The schema canonicalises bare `{ url }` documents to
    // `{ kind: "url", url }` — preserve scope of assertion to identity.
    expect(merged.documents).toEqual(desired.documents);
  });

  // recipe-change classification → desired always wins (no policy
  // gate — recipe-change means safe-update).
  it("desired wins on recipe-change regardless of policy", () => {
    const original = fullKit();
    const baseline = captureBrandBaselinePayload(original);
    const desired = recipe({ ...original, description: "Recipe edit" });
    const classifications = classifyBrandCells(desired, original, baseline);
    for (const policy of ["recipe-wins", "cms-wins", "error"] as const) {
      const { merged, policyErrors } = mergeBrandByPolicy(
        desired,
        original,
        classifications,
        policy
      );
      expect(merged.description).toBe("Recipe edit");
      expect(policyErrors).toEqual([]);
    }
  });
});
