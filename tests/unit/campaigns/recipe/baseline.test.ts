import { describe, expect, it } from "vitest";
import {
  captureCampaignBaselinePayload,
  cellResolution,
  classifyCampaignCells,
  hashCampaignCells,
  mergeCampaignByPolicy,
} from "../../../../src/campaigns/recipe/baseline";
import { hashJsonValue } from "../../../../src/sync";
import { CampaignRecipeSchema } from "../../../../src/campaigns/recipe/schema";

const recipe = (input: unknown) => CampaignRecipeSchema.parse(input);

const fullCampaign = () =>
  recipe({
    name: "Q3 Launch",
    description: "Product launch wave",
    status: "NOT_STARTED",
    startDate: "2026-07-01",
    dueDate: "2026-09-30",
    brandKitId: "acme-uuid",
    labels: ["launch", "Q3"],
    deliverables: [
      {
        name: "Landing Page",
        status: "NOT_STARTED",
        dueDate: "2026-07-15",
        funnelStage: "TOP",
        funnelTactics: ["awareness"],
        labels: ["web"],
        tasks: [
          {
            name: "Draft copy",
            status: "NOT_STARTED",
            dueDate: "2026-07-10",
            priority: "HIGH",
            description: "First draft of landing copy",
            assignee: "writer@acme.test",
            labels: ["copy"],
          },
          {
            name: "Hero design",
            status: "NOT_STARTED",
            dueDate: "2026-07-12",
            priority: "MEDIUM",
            description: "Hero illustration",
            assignee: "designer@acme.test",
            labels: ["design"],
          },
        ],
      },
    ],
  });

describe("hashCampaignCells", () => {
  it("emits project-level cells for every scalar (description / status / dates / brandKitId / labels)", () => {
    const cells = hashCampaignCells(fullCampaign());
    expect(cells["project.description"]).toBe(hashJsonValue("Product launch wave"));
    expect(cells["project.status"]).toBe(hashJsonValue("NOT_STARTED"));
    expect(cells["project.startDate"]).toBe(hashJsonValue("2026-07-01"));
    expect(cells["project.dueDate"]).toBe(hashJsonValue("2026-09-30"));
    expect(cells["project.brandKitId"]).toBe(hashJsonValue("acme-uuid"));
    expect(cells["project.labels"]).toBe(hashJsonValue(["launch", "Q3"]));
  });

  it("emits deliverable-level cells under deliverables.<name>.<element>", () => {
    const cells = hashCampaignCells(fullCampaign());
    expect(cells["deliverables.Landing Page.status"]).toBe(hashJsonValue("NOT_STARTED"));
    expect(cells["deliverables.Landing Page.funnelStage"]).toBe(hashJsonValue("TOP"));
    expect(cells["deliverables.Landing Page.funnelTactics"]).toBe(hashJsonValue(["awareness"]));
    expect(cells["deliverables.Landing Page.labels"]).toBe(hashJsonValue(["web"]));
  });

  it("emits task-level cells under deliverables.<name>.tasks.<name>.<element>", () => {
    const cells = hashCampaignCells(fullCampaign());
    expect(cells["deliverables.Landing Page.tasks.Draft copy.status"]).toBe(
      hashJsonValue("NOT_STARTED")
    );
    expect(cells["deliverables.Landing Page.tasks.Draft copy.priority"]).toBe(
      hashJsonValue("HIGH")
    );
    expect(cells["deliverables.Landing Page.tasks.Draft copy.assignee"]).toBe(
      hashJsonValue("writer@acme.test")
    );
    expect(cells["deliverables.Landing Page.tasks.Hero design.priority"]).toBe(
      hashJsonValue("MEDIUM")
    );
  });

  // Empty arrays / absent values still emit cells with stable hashes —
  // the planner expects every cell-path the recipe defines, regardless
  // of populated-or-not state.
  it("emits cells for absent + empty values, hashed as undefined / []", () => {
    const sparse = recipe({
      name: "Sparse",
      deliverables: [
        {
          name: "D",
          tasks: [{ name: "T" }],
        },
      ],
    });
    const cells = hashCampaignCells(sparse);
    expect(cells["project.description"]).toBe(hashJsonValue(undefined));
    expect(cells["project.labels"]).toBe(hashJsonValue([]));
    expect(cells["deliverables.D.funnelTactics"]).toBe(hashJsonValue([]));
    expect(cells["deliverables.D.tasks.T.status"]).toBe(hashJsonValue(undefined));
  });

  // A campaign with no deliverables emits ONLY project-level cells —
  // no per-deliverable / per-task entries leak in.
  it("emits ONLY project cells when the campaign has no deliverables", () => {
    const empty = recipe({ name: "Empty" });
    const cells = hashCampaignCells(empty);
    const projectPaths = Object.keys(cells).filter((p) => p.startsWith("project."));
    expect(projectPaths.length).toBe(Object.keys(cells).length);
  });
});

describe("captureCampaignBaselinePayload", () => {
  it("wraps hashCampaignCells with the schemaVersion envelope", () => {
    const payload = captureCampaignBaselinePayload(fullCampaign());
    expect(payload.schemaVersion).toBe("1");
    expect(payload.cells).toEqual(hashCampaignCells(fullCampaign()));
  });
});

describe("classifyCampaignCells", () => {
  it("returns first-push for every cell when baseline is undefined", () => {
    const r = fullCampaign();
    const classifications = classifyCampaignCells(r, r, undefined);
    for (const c of Object.values(classifications)) {
      expect(c).toBe("first-push");
    }
  });

  it("classifies all-equal cells as recipe-change (degenerate)", () => {
    const r = fullCampaign();
    const baseline = captureCampaignBaselinePayload(r);
    const classifications = classifyCampaignCells(r, r, baseline);
    for (const c of Object.values(classifications)) {
      expect(c).toBe("recipe-change");
    }
  });

  it("classifies a task-level tenant edit as cms-edit", () => {
    const desired = fullCampaign();
    const baseline = captureCampaignBaselinePayload(desired);
    const tenantMoved = recipe({
      ...desired,
      deliverables: [
        {
          ...desired.deliverables[0],
          tasks: [
            { ...desired.deliverables[0].tasks[0], priority: "MEDIUM" },
            desired.deliverables[0].tasks[1],
          ],
        },
      ],
    });
    const classifications = classifyCampaignCells(desired, tenantMoved, baseline);
    expect(classifications["deliverables.Landing Page.tasks.Draft copy.priority"]).toBe("cms-edit");
    // Other task field unchanged
    expect(classifications["deliverables.Landing Page.tasks.Draft copy.status"]).toBe(
      "recipe-change"
    );
  });

  it("classifies both-sides-moved on a deliverable-level cell as conflict", () => {
    const original = fullCampaign();
    const baseline = captureCampaignBaselinePayload(original);
    const desired = recipe({
      ...original,
      deliverables: [{ ...original.deliverables[0], funnelStage: "MID" }],
    });
    const current = recipe({
      ...original,
      deliverables: [{ ...original.deliverables[0], funnelStage: "BOTTOM" }],
    });
    const classifications = classifyCampaignCells(desired, current, baseline);
    expect(classifications["deliverables.Landing Page.funnelStage"]).toBe("conflict");
  });
});

describe("cellResolution", () => {
  it("first-push always picks desired regardless of policy", () => {
    expect(cellResolution("first-push", "error")).toBe("desired");
    expect(cellResolution("first-push", "recipe-wins")).toBe("desired");
    expect(cellResolution("first-push", "cms-wins")).toBe("desired");
  });

  it("recipe-change always picks desired regardless of policy", () => {
    expect(cellResolution("recipe-change", "error")).toBe("desired");
    expect(cellResolution("recipe-change", "recipe-wins")).toBe("desired");
    expect(cellResolution("recipe-change", "cms-wins")).toBe("desired");
  });

  it("cms-edit + cms-wins → current; + recipe-wins → desired; + error → policyError", () => {
    expect(cellResolution("cms-edit", "cms-wins")).toBe("current");
    expect(cellResolution("cms-edit", "recipe-wins")).toBe("desired");
    expect(cellResolution("cms-edit", "error")).toBe("policyError");
  });

  it("conflict + cms-wins → current; + recipe-wins → desired; + error → policyError", () => {
    expect(cellResolution("conflict", "cms-wins")).toBe("current");
    expect(cellResolution("conflict", "recipe-wins")).toBe("desired");
    expect(cellResolution("conflict", "error")).toBe("policyError");
  });
});

describe("mergeCampaignByPolicy", () => {
  it("recipe-wins keeps desired on cms-edit task cells", () => {
    const desired = fullCampaign();
    const baseline = captureCampaignBaselinePayload(desired);
    const current = recipe({
      ...desired,
      deliverables: [
        {
          ...desired.deliverables[0],
          tasks: [
            { ...desired.deliverables[0].tasks[0], priority: "LOW" },
            desired.deliverables[0].tasks[1],
          ],
        },
      ],
    });
    const classifications = classifyCampaignCells(desired, current, baseline);
    const { merged, policyErrors } = mergeCampaignByPolicy(
      desired,
      current,
      classifications,
      "recipe-wins"
    );
    expect(policyErrors).toEqual([]);
    expect(merged.deliverables[0].tasks[0].priority).toBe("HIGH");
  });

  it("cms-wins keeps tenant value on a cms-edit task cell", () => {
    const desired = fullCampaign();
    const baseline = captureCampaignBaselinePayload(desired);
    const current = recipe({
      ...desired,
      deliverables: [
        {
          ...desired.deliverables[0],
          tasks: [
            { ...desired.deliverables[0].tasks[0], priority: "LOW" },
            desired.deliverables[0].tasks[1],
          ],
        },
      ],
    });
    const classifications = classifyCampaignCells(desired, current, baseline);
    const { merged } = mergeCampaignByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.deliverables[0].tasks[0].priority).toBe("LOW");
  });

  it("error surfaces policyError per cms-edit cell + retains desired", () => {
    const desired = fullCampaign();
    const baseline = captureCampaignBaselinePayload(desired);
    const current = recipe({
      ...desired,
      deliverables: [
        {
          ...desired.deliverables[0],
          tasks: [
            { ...desired.deliverables[0].tasks[0], priority: "LOW" },
            desired.deliverables[0].tasks[1],
          ],
        },
      ],
    });
    const classifications = classifyCampaignCells(desired, current, baseline);
    const { merged, policyErrors } = mergeCampaignByPolicy(
      desired,
      current,
      classifications,
      "error"
    );
    expect(policyErrors).toHaveLength(1);
    expect(policyErrors[0]?.path).toBe("deliverables.Landing Page.tasks.Draft copy.priority");
    expect(merged.deliverables[0].tasks[0].priority).toBe("HIGH");
  });

  // Tenant-only deliverable — recipe didn't ask for it; merge skips.
  it("does not pull tenant-only deliverables into the merged recipe", () => {
    const desired = recipe({
      name: "C",
      deliverables: [{ name: "D1", tasks: [] }],
    });
    const current = recipe({
      name: "C",
      deliverables: [
        { name: "D1", tasks: [] },
        { name: "TenantOnly", tasks: [] },
      ],
    });
    const classifications = classifyCampaignCells(desired, current, undefined);
    const { merged } = mergeCampaignByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.deliverables.map((d) => d.name)).toEqual(["D1"]);
  });

  // Tenant-only task within a recipe-declared deliverable — also skipped.
  it("does not pull tenant-only tasks within a recipe-declared deliverable", () => {
    const desired = recipe({
      name: "C",
      deliverables: [{ name: "D1", tasks: [{ name: "T1" }] }],
    });
    const current = recipe({
      name: "C",
      deliverables: [{ name: "D1", tasks: [{ name: "T1" }, { name: "TenantOnlyTask" }] }],
    });
    const classifications = classifyCampaignCells(desired, current, undefined);
    const { merged } = mergeCampaignByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.deliverables[0].tasks.map((t) => t.name)).toEqual(["T1"]);
  });

  // A desired deliverable absent from tenant — recipe-author still
  // wants it, so pass through as-is (no merge candidate).
  it("preserves a recipe-only deliverable as-is when tenant lacks it", () => {
    const desired = recipe({
      name: "C",
      deliverables: [{ name: "RecipeOnly", funnelStage: "TOP", tasks: [] }],
    });
    const current = recipe({ name: "C", deliverables: [] });
    const classifications = classifyCampaignCells(desired, current, undefined);
    const { merged } = mergeCampaignByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.deliverables[0].name).toBe("RecipeOnly");
    expect(merged.deliverables[0].funnelStage).toBe("TOP");
  });

  // recipe-only task within a deliverable shared by both — passes
  // through unchanged.
  it("preserves recipe-only tasks within a shared deliverable", () => {
    const desired = recipe({
      name: "C",
      deliverables: [
        {
          name: "D1",
          tasks: [{ name: "Shared" }, { name: "RecipeOnly", priority: "HIGH" }],
        },
      ],
    });
    const current = recipe({
      name: "C",
      deliverables: [{ name: "D1", tasks: [{ name: "Shared" }] }],
    });
    const classifications = classifyCampaignCells(desired, current, undefined);
    const { merged } = mergeCampaignByPolicy(desired, current, classifications, "cms-wins");
    expect(merged.deliverables[0].tasks.map((t) => t.name).sort()).toEqual([
      "RecipeOnly",
      "Shared",
    ]);
    const recipeOnly = merged.deliverables[0].tasks.find((t) => t.name === "RecipeOnly");
    expect(recipeOnly?.priority).toBe("HIGH");
  });
});
