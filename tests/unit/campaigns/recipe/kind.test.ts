import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → client bridge so the kind never reads real config.
vi.mock("../../../../src/campaigns/recipe/client", () => ({
  resolveCampaignClient: async () => ({ accessToken: "tok" }),
}));

// Mock the Orchestrate API surface the kind composes.
const campaignApi = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  createDeliverable: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock("../../../../src/campaigns", () => campaignApi);

import { campaignKind } from "../../../../src/campaigns/recipe/kind";

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "campaign", id: "Spring Launch" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("campaignKind", () => {
  it("exposes the recipe-kind contract", () => {
    expect(campaignKind.name).toBe("campaign");
    expect(campaignKind.schema).toBeDefined();
    expect(typeof campaignKind.readCurrent).toBe("function");
    expect(typeof campaignKind.apply).toBe("function");
  });
});

describe("readCurrent", () => {
  it("returns null when no project matches the name", async () => {
    campaignApi.listProjects.mockResolvedValue({ totalCount: 0, data: [], next: null });
    expect(await campaignKind.readCurrent({ kind: "campaign", id: "Nope" }, ctx)).toBeNull();
  });

  it("builds a recipe from project + deliverables + tasks, surfacing server ids as sitecoreId", async () => {
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-1", name: "Spring Launch" }],
    });
    campaignApi.getProject.mockResolvedValue({
      id: "proj-1",
      name: "Spring Launch",
      description: "Q2",
      status: "NOT_STARTED",
      start_date: "2026-04-01",
      due_date: null,
      brandkit_id: "kit-1",
      labels: ["q2"],
      deliverables: [
        {
          id: "del-1",
          name: "Landing page",
          status: "NOT_STARTED",
          due_date: null,
          funnel_stage: "TOP",
          funnel_tactics: ["seo"],
          tasks: [
            {
              id: "task-1",
              name: "Draft copy",
              status: "NOT_STARTED",
              due_date: null,
              priority: null,
              description: null,
              assignee: null,
            },
          ],
        },
      ],
    });

    const recipe = await campaignKind.readCurrent(ref, ctx);
    expect(recipe).toMatchObject({
      // Server UUIDs round-trip onto the recipe as `sitecoreId` so the
      // diff/merge can match by id (rename-safe) on the next push.
      sitecoreId: "proj-1",
      name: "Spring Launch",
      description: "Q2",
      brandKitId: "kit-1",
      deliverables: [
        {
          sitecoreId: "del-1",
          name: "Landing page",
          funnelStage: "TOP",
          tasks: [{ sitecoreId: "task-1", name: "Draft copy", status: "NOT_STARTED" }],
        },
      ],
    });
  });

  it("matches a RENAMED campaign by its handle: label when ref.baselineKey is set (pull-by-identity)", async () => {
    // The tenant project still has its old name + the stable handle label.
    // The recipe was renamed, so id (display name) no longer matches — but
    // the handle does. Without this, pull silently finds nothing.
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-9", name: "Old Name", labels: ["story:s1", "handle:spring@1"] }],
    });
    campaignApi.getProject.mockResolvedValue({
      id: "proj-9",
      name: "Old Name",
      labels: ["story:s1", "handle:spring@1"],
      deliverables: [],
    });

    const recipe = await campaignKind.readCurrent(
      // id is the NEW (renamed) display name; baselineKey carries the handle.
      { kind: "campaign", id: "New Name", baselineKey: "spring@1" },
      ctx
    );
    expect(recipe?.sitecoreId).toBe("proj-9");
    // Resolved by handle label, not by name (no name in the list matches "New Name").
    expect(campaignApi.getProject).toHaveBeenCalledWith(expect.anything(), "proj-9");
  });

  it("does NOT match by name alone when a baselineKey handle is given but no label matches", async () => {
    // Guards the relaxation: a handle that matches nothing must not silently
    // fall through to an unrelated name — it returns the name fallback only.
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-x", name: "Unrelated", labels: ["handle:other@1"] }],
    });
    const recipe = await campaignKind.readCurrent(
      { kind: "campaign", id: "Missing", baselineKey: "spring@1" },
      ctx
    );
    expect(recipe).toBeNull();
  });

  it("reads by sitecoreId (ref.tenantId) and skips findProjectByName", async () => {
    campaignApi.getProject.mockResolvedValue({
      id: "proj-direct",
      name: "Spring Launch (renamed on tenant)",
      description: "",
      status: "NOT_STARTED",
      start_date: null,
      due_date: null,
      brandkit_id: null,
      labels: [],
      deliverables: [],
    });

    const recipe = await campaignKind.readCurrent(
      { kind: "campaign", id: "Spring Launch", tenantId: "proj-direct" },
      ctx
    );

    expect(recipe?.name).toBe("Spring Launch (renamed on tenant)");
    expect(campaignApi.getProject).toHaveBeenCalledWith(expect.anything(), "proj-direct");
    expect(campaignApi.listProjects).not.toHaveBeenCalled();
  });

  it("falls back to name search when ref.tenantId resolves but is stale", async () => {
    // First getProject (by ref.tenantId) throws — the project was deleted/replaced.
    campaignApi.getProject.mockRejectedValueOnce(new Error("404 Not Found"));
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-fresh", name: "Spring Launch" }],
    });
    // Second getProject (by found.id from the name search) succeeds.
    campaignApi.getProject.mockResolvedValueOnce({
      id: "proj-fresh",
      name: "Spring Launch",
      description: "",
      status: "NOT_STARTED",
      start_date: null,
      due_date: null,
      brandkit_id: null,
      labels: [],
      deliverables: [],
    });

    const recipe = await campaignKind.readCurrent(
      { kind: "campaign", id: "Spring Launch", tenantId: "stale-id" },
      ctx
    );

    expect(recipe?.name).toBe("Spring Launch");
    expect(campaignApi.listProjects).toHaveBeenCalledOnce();
  });

  it("reverse-maps task dependency UUIDs to handles via labels", async () => {
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-1", name: "Spring Launch" }],
    });
    campaignApi.getProject.mockResolvedValue({
      id: "proj-1",
      name: "Spring Launch",
      description: "",
      status: "NOT_STARTED",
      start_date: null,
      due_date: null,
      brandkit_id: null,
      labels: [],
      deliverables: [
        {
          id: "del-1",
          name: "Email blast",
          status: "NOT_STARTED",
          due_date: null,
          funnel_stage: "TOP",
          funnel_tactics: [],
          labels: [],
          tasks: [
            {
              id: "task-upstream",
              name: "Draft copy",
              labels: ["handle:draft-copy@1"],
              dependencies: [],
            },
            {
              id: "task-downstream",
              name: "Review copy",
              labels: ["handle:review-copy@1"],
              dependencies: [
                {
                  project_id: "proj-1",
                  project_deliverable_id: "del-1",
                  task_id: "task-upstream",
                },
                {
                  project_id: "proj-1",
                  project_deliverable_id: "del-1",
                  task_id: "task-without-handle",
                },
              ],
            },
            {
              // No handle label — can't be referenced by other tasks; survives
              // as a task on the recipe but won't appear in dependencies.
              id: "task-without-handle",
              name: "Set ad budget",
              labels: [],
              dependencies: [],
            },
          ],
        },
      ],
    });

    const recipe = await campaignKind.readCurrent(ref, ctx);
    const tasks = recipe?.deliverables?.[0]?.tasks ?? [];
    const downstream = tasks.find((t) => t.name === "Review copy");
    expect(downstream?.dependencies).toEqual(["draft-copy@1"]);
    // Tasks without a handle:<x> label are silently dropped from the
    // dependency list (would need to be addressed by UUID, which the
    // recipe shape doesn't support).
    const handleless = tasks.find((t) => t.name === "Set ad budget");
    expect(handleless?.handle).toBeUndefined();
  });

  it("pages the project list to find a match", async () => {
    campaignApi.listProjects
      .mockResolvedValueOnce({
        totalCount: 2,
        next: "cursor-2",
        data: [{ id: "p1", name: "Other" }],
      })
      .mockResolvedValueOnce({
        totalCount: 2,
        next: null,
        data: [{ id: "p2", name: "Spring Launch" }],
      });
    campaignApi.getProject.mockResolvedValue({
      id: "p2",
      name: "Spring Launch",
      description: "",
      status: "NOT_STARTED",
      start_date: null,
      due_date: null,
      brandkit_id: null,
      labels: [],
      deliverables: [],
    });

    const recipe = await campaignKind.readCurrent(ref, ctx);
    expect(recipe?.name).toBe("Spring Launch");
    expect(campaignApi.listProjects).toHaveBeenCalledTimes(2);
  });
});

describe("apply", () => {
  it("creates the campaign when the plan has a project change", async () => {
    campaignApi.createProject.mockResolvedValue({ id: "proj-9", name: "New", deliverables: [] });

    const result = await campaignKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "project",
            summary: 'Create campaign "New"',
            after: "New",
            meta: { stage: "project", description: "d", labels: [] },
          },
        ],
      },
      { kind: "campaign", id: "New" },
      ctx
    );

    expect(campaignApi.createProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "New", description: "d" })
    );
    expect(result.applied).toHaveLength(1);
  });

  it("creates a missing deliverable then its tasks against an existing campaign", async () => {
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-1", name: "Spring Launch" }],
    });
    campaignApi.getProject.mockResolvedValue({
      id: "proj-1",
      name: "Spring Launch",
      deliverables: [],
    });
    campaignApi.createDeliverable.mockResolvedValue({
      id: "del-9",
      name: "Email blast",
      tasks: [],
    });
    campaignApi.createTask.mockResolvedValue({ id: "task-9", name: "Write subject line" });

    const result = await campaignKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "deliverables.Email blast",
            summary: 'Create deliverable "Email blast"',
            after: "Email blast",
            meta: {
              stage: "deliverable",
              deliverableName: "Email blast",
              deliverable: { name: "Email blast", funnelTactics: [], tasks: [] },
            },
          },
          {
            kind: "create",
            path: "deliverables.Email blast.tasks.Write subject line",
            summary: "Email blast / Write subject line",
            after: { name: "Write subject line" },
            meta: {
              stage: "task",
              deliverableName: "Email blast",
              taskName: "Write subject line",
              task: { name: "Write subject line" },
            },
          },
        ],
      },
      ref,
      ctx
    );

    expect(campaignApi.createDeliverable).toHaveBeenCalledOnce();
    expect(campaignApi.createTask).toHaveBeenCalledOnce();
    expect(result.applied).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it("surfaces an identity for every deliverable and task — handle-less included — with parentName", async () => {
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-1", name: "Spring Launch" }],
    });
    // First read (resolution) sees an empty project; the converged
    // re-read at the end of apply returns the created tree.
    campaignApi.getProject
      .mockResolvedValueOnce({ id: "proj-1", name: "Spring Launch", deliverables: [] })
      .mockResolvedValue({
        id: "proj-1",
        name: "Spring Launch",
        deliverables: [
          {
            id: "del-9",
            name: "Email blast",
            labels: [],
            tasks: [
              // Handle-less task — the case the old emission dropped.
              { id: "task-9", name: "Write subject line", labels: [] },
              { id: "task-10", name: "Draft body", labels: ["handle:draft-body@1"] },
            ],
          },
        ],
      });
    campaignApi.createDeliverable.mockResolvedValue({
      id: "del-9",
      name: "Email blast",
      tasks: [],
    });
    campaignApi.createTask
      .mockResolvedValueOnce({ id: "task-9", name: "Write subject line" })
      .mockResolvedValueOnce({ id: "task-10", name: "Draft body" });

    const result = await campaignKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "deliverables.Email blast",
            summary: 'Create deliverable "Email blast"',
            after: "Email blast",
            meta: {
              stage: "deliverable",
              deliverableName: "Email blast",
              deliverable: { name: "Email blast", funnelTactics: [], tasks: [] },
            },
          },
          {
            kind: "create",
            path: "deliverables.Email blast.tasks.Write subject line",
            summary: "Email blast / Write subject line",
            after: { name: "Write subject line" },
            meta: {
              stage: "task",
              deliverableName: "Email blast",
              taskName: "Write subject line",
              task: { name: "Write subject line" },
            },
          },
          {
            kind: "create",
            path: "deliverables.Email blast.tasks.Draft body",
            summary: "Email blast / Draft body",
            after: { name: "Draft body", handle: "draft-body@1" },
            meta: {
              stage: "task",
              deliverableName: "Email blast",
              taskName: "Draft body",
              task: { name: "Draft body", handle: "draft-body@1" },
            },
          },
        ],
      },
      ref,
      ctx
    );

    const ids = result.identities ?? [];
    const handleLess = ids.find((i) => i.scope === "task" && i.sitecoreId === "task-9");
    expect(handleLess).toMatchObject({ name: "Write subject line", parentName: "Email blast" });
    expect(handleLess?.handle).toBeUndefined();

    const handled = ids.find((i) => i.scope === "task" && i.sitecoreId === "task-10");
    expect(handled).toMatchObject({
      name: "Draft body",
      handle: "draft-body@1",
      parentName: "Email blast",
    });

    const deliverable = ids.find((i) => i.scope === "deliverable" && i.sitecoreId === "del-9");
    expect(deliverable).toMatchObject({ name: "Email blast", parentName: "Spring Launch" });
  });

  it("converges a created task's update-only fields with a follow-up updateTask", async () => {
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-1", name: "Spring Launch" }],
    });
    campaignApi.getProject.mockResolvedValue({
      id: "proj-1",
      name: "Spring Launch",
      deliverables: [{ id: "del-1", name: "Email blast", tasks: [] }],
    });
    campaignApi.createTask.mockResolvedValue({ id: "task-9", name: "Write subject line" });
    campaignApi.updateTask.mockResolvedValue({ id: "task-9", name: "Write subject line" });

    const result = await campaignKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "deliverables.Email blast.tasks.Write subject line",
            summary: "Email blast / Write subject line",
            after: { name: "Write subject line" },
            meta: {
              stage: "task",
              deliverableName: "Email blast",
              taskName: "Write subject line",
              task: {
                name: "Write subject line",
                priority: "HIGH",
                description: "Punchy.",
                labels: ["q2"],
              },
            },
          },
        ],
      },
      ref,
      ctx
    );

    // createTask only accepts name/due_date/status — priority, description,
    // and labels must be converged by a follow-up updateTask, not dropped.
    expect(campaignApi.createTask).toHaveBeenCalledOnce();
    expect(campaignApi.updateTask).toHaveBeenCalledOnce();
    expect(campaignApi.updateTask.mock.calls[0][4]).toMatchObject({
      priority: "HIGH",
      description: "Punchy.",
      labels: ["q2"],
    });
    expect(result.applied).toHaveLength(1);
  });

  it("PUT-replaces a changed task on an existing deliverable", async () => {
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-1", name: "Spring Launch" }],
    });
    campaignApi.getProject.mockResolvedValue({
      id: "proj-1",
      name: "Spring Launch",
      deliverables: [
        { id: "del-1", name: "Landing page", tasks: [{ id: "task-1", name: "Draft copy" }] },
      ],
    });
    campaignApi.updateTask.mockResolvedValue({ id: "task-1", name: "Draft copy" });

    const result = await campaignKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "deliverables.Landing page.tasks.Draft copy",
            summary: "Landing page / Draft copy",
            after: { name: "Draft copy", status: "DONE" },
            meta: {
              stage: "task",
              deliverableName: "Landing page",
              taskName: "Draft copy",
              task: { name: "Draft copy", status: "DONE" },
            },
          },
        ],
      },
      ref,
      ctx
    );

    expect(campaignApi.updateTask).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      "del-1",
      "task-1",
      expect.objectContaining({ name: "Draft copy", status: "DONE" })
    );
    expect(result.applied).toHaveLength(1);
  });

  it("skips a task change whose parent deliverable never resolves", async () => {
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-1", name: "Spring Launch" }],
    });
    campaignApi.getProject.mockResolvedValue({
      id: "proj-1",
      name: "Spring Launch",
      deliverables: [],
    });

    const result = await campaignKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "deliverables.Ghost.tasks.Orphan",
            summary: "Ghost / Orphan",
            after: { name: "Orphan" },
            meta: {
              stage: "task",
              deliverableName: "Ghost",
              taskName: "Orphan",
              task: { name: "Orphan" },
            },
          },
        ],
      },
      ref,
      ctx
    );

    expect(campaignApi.createTask).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
    expect(result.applied).toHaveLength(0);
  });

  it("throws when applying to a campaign that does not exist", async () => {
    campaignApi.listProjects.mockResolvedValue({ totalCount: 0, next: null, data: [] });

    await expect(
      campaignKind.apply(
        {
          changes: [
            {
              kind: "update",
              path: "deliverables.X.tasks.Y",
              summary: "X / Y",
              meta: { stage: "task", deliverableName: "X", taskName: "Y", task: { name: "Y" } },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow(/not found/);
  });

  it("skips noop task changes without writing", async () => {
    campaignApi.listProjects.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [{ id: "proj-1", name: "Spring Launch" }],
    });
    campaignApi.getProject.mockResolvedValue({
      id: "proj-1",
      name: "Spring Launch",
      deliverables: [
        { id: "del-1", name: "Landing page", tasks: [{ id: "task-1", name: "Draft copy" }] },
      ],
    });

    const result = await campaignKind.apply(
      {
        changes: [
          {
            kind: "noop",
            path: "deliverables.Landing page.tasks.Draft copy",
            summary: "Landing page / Draft copy unchanged",
            meta: {
              stage: "task",
              deliverableName: "Landing page",
              taskName: "Draft copy",
              task: { name: "Draft copy" },
            },
          },
        ],
      },
      ref,
      ctx
    );

    expect(campaignApi.createTask).not.toHaveBeenCalled();
    expect(campaignApi.updateTask).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
  });
});
