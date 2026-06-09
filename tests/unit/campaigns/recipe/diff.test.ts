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

  it("treats a renamed task (same sitecoreId) as an update, not a create", () => {
    const withIds = recipe({
      name: "Spring Launch",
      deliverables: [
        {
          name: "Landing page",
          sitecoreId: "11111111-1111-4111-8111-111111111111",
          tasks: [{ name: "Draft copy", sitecoreId: "22222222-2222-4222-8222-222222222222" }],
        },
      ],
    });
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [
          {
            name: "Landing page",
            sitecoreId: "11111111-1111-4111-8111-111111111111",
            tasks: [
              // Same id, new display name — a rename.
              { name: "Draft hero copy", sitecoreId: "22222222-2222-4222-8222-222222222222" },
            ],
          },
        ],
      }),
      withIds
    );
    const taskChange = plan.changes.find((c) => c.meta?.stage === "task");
    expect(taskChange?.kind).toBe("update");
    expect((taskChange?.before as { name: string }).name).toBe("Draft copy");
    expect((taskChange?.after as { name: string }).name).toBe("Draft hero copy");
    // No stray create for the new name.
    expect(plan.changes.filter((c) => c.kind === "create")).toHaveLength(0);
  });

  it("treats a renamed task (same handle, no id) as an update", () => {
    const withHandles = recipe({
      name: "Spring Launch",
      deliverables: [
        { name: "Landing page", tasks: [{ name: "Draft copy", handle: "draft-copy@1" }] },
      ],
    });
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [
          { name: "Landing page", tasks: [{ name: "Draft hero copy", handle: "draft-copy@1" }] },
        ],
      }),
      withHandles
    );
    const taskChange = plan.changes.find((c) => c.meta?.stage === "task");
    expect(taskChange?.kind).toBe("update");
    expect(plan.changes.filter((c) => c.kind === "create")).toHaveLength(0);
  });

  it("treats a renamed deliverable (same id) as an update of its tasks, not a new deliverable", () => {
    const withIds = recipe({
      name: "Spring Launch",
      deliverables: [
        {
          name: "Landing page",
          sitecoreId: "11111111-1111-4111-8111-111111111111",
          tasks: [{ name: "Draft copy", sitecoreId: "22222222-2222-4222-8222-222222222222" }],
        },
      ],
    });
    const plan = diffCampaign(
      recipe({
        name: "Spring Launch",
        deliverables: [
          {
            // Renamed deliverable, same id.
            name: "Hero landing page",
            sitecoreId: "11111111-1111-4111-8111-111111111111",
            tasks: [{ name: "Draft copy", sitecoreId: "22222222-2222-4222-8222-222222222222" }],
          },
        ],
      }),
      withIds
    );
    // No deliverable create — it matched the existing one by id.
    expect(
      plan.changes.some(
        (c) => c.path.startsWith("deliverables.Hero landing page") && c.kind === "create"
      )
    ).toBe(false);
    // The unchanged task under the renamed deliverable is a noop, not a create.
    const taskChange = plan.changes.find((c) => c.meta?.stage === "task");
    expect(taskChange?.kind).toBe("noop");
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
