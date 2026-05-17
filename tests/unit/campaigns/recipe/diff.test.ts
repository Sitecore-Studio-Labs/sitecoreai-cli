import { describe, expect, it } from "vitest";
import { CampaignRecipeSchema } from "../../../../src/campaigns/recipe/schema";
import { diffCampaign } from "../../../../src/campaigns/recipe/diff";

const recipe = (input: unknown) => CampaignRecipeSchema.parse(input);

describe("diffCampaign — campaign absent", () => {
  it("plans project creation when there are no deliverables", () => {
    const plan = diffCampaign(recipe({ name: "Spring Launch" }), null);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      kind: "create",
      path: "project",
      after: "Spring Launch",
    });
    expect(plan.changes[0].meta).toMatchObject({ stage: "project" });
  });

  it("carries project metadata in the project change's meta", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        description: "Q2 campaign",
        status: "NOT_STARTED",
        startDate: "2026-04-01",
        dueDate: "2026-06-30",
        brandKitId: "kit-1",
        labels: ["q2"],
      }),
      null
    );
    expect(plan.changes[0].meta).toMatchObject({
      stage: "project",
      description: "Q2 campaign",
      status: "NOT_STARTED",
      startDate: "2026-04-01",
      dueDate: "2026-06-30",
      brandKitId: "kit-1",
      labels: ["q2"],
    });
  });

  it("plans project + deliverable + task creates for a full recipe", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [
          { name: "Landing page", tasks: [{ name: "Draft copy" }, { name: "Review" }] },
        ],
      }),
      null
    );
    expect(plan.changes.map((c) => [c.kind, c.path])).toEqual([
      ["create", "project"],
      ["create", "deliverables.Landing page"],
      ["create", "deliverables.Landing page.tasks.Draft copy"],
      ["create", "deliverables.Landing page.tasks.Review"],
    ]);
  });

  it("tags task changes with their parent deliverable in meta", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [{ name: "Landing page", tasks: [{ name: "Draft copy" }] }],
      }),
      null
    );
    const taskChange = plan.changes.find((c) => c.meta?.stage === "task");
    expect(taskChange?.meta).toMatchObject({
      stage: "task",
      deliverableName: "Landing page",
      taskName: "Draft copy",
    });
  });
});

describe("diffCampaign — campaign present", () => {
  const current = recipe({
    name: "Spring Launch",
    deliverables: [
      {
        name: "Landing page",
        tasks: [
          { name: "Draft copy", status: "NOT_STARTED" },
          { name: "Review", status: "IN_PROGRESS" },
        ],
      },
    ],
  });

  it("never emits a project change for an existing campaign", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        description: "changed metadata",
        deliverables: [{ name: "Landing page", tasks: [{ name: "Draft copy" }] }],
      }),
      current
    );
    expect(plan.changes.some((c) => c.meta?.stage === "project")).toBe(false);
  });

  it("marks an unchanged task as noop", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [
          { name: "Landing page", tasks: [{ name: "Draft copy", status: "NOT_STARTED" }] },
        ],
      }),
      current
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      kind: "noop",
      path: "deliverables.Landing page.tasks.Draft copy",
    });
  });

  it("marks a changed task as update with before/after", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [{ name: "Landing page", tasks: [{ name: "Draft copy", status: "DONE" }] }],
      }),
      current
    );
    expect(plan.changes[0]).toMatchObject({
      kind: "update",
      path: "deliverables.Landing page.tasks.Draft copy",
    });
    expect((plan.changes[0].before as { status: string }).status).toBe("NOT_STARTED");
    expect((plan.changes[0].after as { status: string }).status).toBe("DONE");
  });

  it("flags a task absent on the deliverable as a create change", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [{ name: "Landing page", tasks: [{ name: "Brand new task" }] }],
      }),
      current
    );
    expect(plan.changes[0]).toMatchObject({
      kind: "create",
      path: "deliverables.Landing page.tasks.Brand new task",
    });
  });

  it("creates a deliverable absent on the campaign, plus its tasks", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [{ name: "Email blast", tasks: [{ name: "Write subject line" }] }],
      }),
      current
    );
    expect(plan.changes.map((c) => [c.kind, c.path])).toEqual([
      ["create", "deliverables.Email blast"],
      ["create", "deliverables.Email blast.tasks.Write subject line"],
    ]);
  });

  it("is a no-op when desired matches current exactly", () => {
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [
          {
            name: "Landing page",
            tasks: [
              { name: "Draft copy", status: "NOT_STARTED" },
              { name: "Review", status: "IN_PROGRESS" },
            ],
          },
        ],
      }),
      current
    );
    expect(plan.changes.every((c) => c.kind === "noop")).toBe(true);
  });
});
