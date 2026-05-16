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

  it("builds a recipe from project + deliverables + tasks, dropping server ids", async () => {
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
      name: "Spring Launch",
      description: "Q2",
      brandKitId: "kit-1",
      deliverables: [
        {
          name: "Landing page",
          funnelStage: "TOP",
          tasks: [{ name: "Draft copy", status: "NOT_STARTED" }],
        },
      ],
    });
    // Server ids never leak into the recipe.
    expect(JSON.stringify(recipe)).not.toContain("proj-1");
    expect(JSON.stringify(recipe)).not.toContain("task-1");
  });

  it("pages the project list to find a match", async () => {
    campaignApi.listProjects
      .mockResolvedValueOnce({ totalCount: 2, next: "cursor-2", data: [{ id: "p1", name: "Other" }] })
      .mockResolvedValueOnce({ totalCount: 2, next: null, data: [{ id: "p2", name: "Spring Launch" }] });
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
