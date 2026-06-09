import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/campaigns/client", () => ({
  resolveCampaignClient: vi.fn(),
}));
vi.mock("../../../../src/campaigns/api/projects", () => ({
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
}));
vi.mock("../../../../src/campaigns/api/deliverables", () => ({
  createDeliverable: vi.fn(),
  deleteDeliverable: vi.fn(),
}));
vi.mock("../../../../src/campaigns/api/tasks", () => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock("../../../../src/campaigns/api/users", () => ({
  listUsers: vi.fn(),
}));

import * as runners from "../../../../src/campaigns/tasks/index";
import { resolveCampaignClient } from "../../../../src/campaigns/client";
import * as projectsApi from "../../../../src/campaigns/api/projects";
import * as deliverablesApi from "../../../../src/campaigns/api/deliverables";
import * as tasksApi from "../../../../src/campaigns/api/tasks";
import * as usersApi from "../../../../src/campaigns/api/users";

const client = { accessToken: "test-token", baseUrl: "https://ai-workflows-eus.example" };

const makeProject = (overrides: Record<string, unknown> = {}) => ({
  id: "proj-1",
  name: "Spring Launch",
  status: "IN_PROGRESS",
  description: "A campaign",
  start_date: "2026-01-01",
  due_date: "2026-03-01",
  brandkit_id: "bk-1",
  project_progress: 0.5,
  members: [{ id: "u1" }],
  deliverables: [{ id: "d1", name: "Landing", funnel_stage: "TOP", tasks: [{ id: "t1" }] }],
  ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  name: "Draft copy",
  status: "NOT_STARTED",
  priority: "HIGH",
  due_date: "2026-02-01",
  assignee: "u1",
  ...overrides,
});

const page = (data: unknown[]) => ({ data, next: null, totalCount: data.length });

let stdout: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(resolveCampaignClient).mockResolvedValue({ client, envName: "test" } as never);
});

afterEach(() => {
  stdout.mockRestore();
});

const jsonOut = (): unknown => {
  const raw = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null"));
  if (raw && typeof raw === "object" && "data" in raw) return (raw as { data: unknown }).data;
  return raw;
};

describe("campaign runners — read verbs", () => {
  it("runCampaignList prints JSON, the human table, and an empty result", async () => {
    vi.mocked(projectsApi.listProjects).mockResolvedValue(page([makeProject()]) as never);
    await runners.runCampaignList({ json: true, limit: 10 });
    expect(vi.mocked(projectsApi.listProjects)).toHaveBeenCalledWith(client, { limit: 10 });
    expect(jsonOut()).toMatchObject({ totalCount: 1 });

    await runners.runCampaignList({ quiet: true });

    vi.mocked(projectsApi.listProjects).mockResolvedValue(page([]) as never);
    const empty = await runners.runCampaignList({ quiet: true });
    expect(empty.totalCount).toBe(0);
  });

  it("runCampaignList --lean emits compact, projected JSON without heavy bodies", async () => {
    vi.mocked(projectsApi.listProjects).mockResolvedValue(
      page([makeProject({ labels: ["story:abc", "handle:spring"] })]) as never
    );

    await runners.runCampaignList({ json: true, lean: true });

    const raw = String(stdout.mock.calls.at(-1)?.[0] ?? "");
    // Compact: no two-space indentation from pretty-printing.
    expect(raw).not.toContain('\n  "');
    const data = jsonOut() as { data: Array<Record<string, unknown>> };
    expect(data.data).toEqual([
      {
        id: "proj-1",
        name: "Spring Launch",
        labels: ["story:abc", "handle:spring"],
        brandkit_id: "bk-1",
        status: "IN_PROGRESS",
      },
    ]);
    // Heavy bodies are dropped from the lean projection.
    expect(data.data[0]).not.toHaveProperty("deliverables");
    expect(data.data[0]).not.toHaveProperty("members");
  });

  it("runCampaignGet prints JSON and human detail with deliverables", async () => {
    vi.mocked(projectsApi.getProject).mockResolvedValue(makeProject() as never);
    await runners.runCampaignGet({ json: true, campaignId: "proj-1" });
    expect(vi.mocked(projectsApi.getProject)).toHaveBeenCalledWith(client, "proj-1");
    expect(jsonOut()).toMatchObject({ id: "proj-1" });

    const result = await runners.runCampaignGet({ quiet: true, campaignId: "proj-1" });
    expect(result.deliverables).toHaveLength(1);
  });

  it("runCampaignUsers prints JSON, the human table, and an empty result", async () => {
    const user = { id: "u1", given_name: "Ada", family_name: "Lovelace", email: "ada@x.io" };
    vi.mocked(usersApi.listUsers).mockResolvedValue(page([user]) as never);
    await runners.runCampaignUsers({ json: true });
    expect(jsonOut()).toMatchObject({ totalCount: 1 });

    await runners.runCampaignUsers({ quiet: true });

    vi.mocked(usersApi.listUsers).mockResolvedValue(page([]) as never);
    const empty = await runners.runCampaignUsers({ quiet: true });
    expect(empty.totalCount).toBe(0);
  });

  it("runTaskList prints JSON, the human table, and an empty result", async () => {
    vi.mocked(tasksApi.listTasks).mockResolvedValue(page([makeTask()]) as never);
    await runners.runTaskList({ json: true, campaignId: "proj-1", deliverableId: "d1" });
    expect(vi.mocked(tasksApi.listTasks)).toHaveBeenCalledWith(client, "proj-1", "d1");
    expect(jsonOut()).toMatchObject({ totalCount: 1 });

    await runners.runTaskList({ quiet: true, campaignId: "proj-1", deliverableId: "d1" });

    vi.mocked(tasksApi.listTasks).mockResolvedValue(page([]) as never);
    const empty = await runners.runTaskList({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
    });
    expect(empty.totalCount).toBe(0);
  });

  it("runTaskGet prints JSON and human detail", async () => {
    vi.mocked(tasksApi.getTask).mockResolvedValue(makeTask() as never);
    await runners.runTaskGet({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
    });
    expect(vi.mocked(tasksApi.getTask)).toHaveBeenCalledWith(client, "proj-1", "d1", "task-1");
    expect(jsonOut()).toMatchObject({ id: "task-1" });

    const result = await runners.runTaskGet({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
    });
    expect(result.id).toBe("task-1");
  });
});

describe("campaign runners — write verbs honour --what-if", () => {
  it("runCampaignCreate plans then creates", async () => {
    const input = { name: "Q3 Push" };
    const planJson = await runners.runCampaignCreate({ json: true, input, whatIf: true });
    expect(planJson).toMatchObject({ plan: input });
    await runners.runCampaignCreate({ quiet: true, input, whatIf: true });
    expect(vi.mocked(projectsApi.createProject)).not.toHaveBeenCalled();

    vi.mocked(projectsApi.createProject).mockResolvedValue(makeProject() as never);
    const createdJson = await runners.runCampaignCreate({ json: true, input });
    expect(createdJson).toMatchObject({ id: "proj-1" });
    const createdHuman = await runners.runCampaignCreate({ quiet: true, input });
    expect(createdHuman).toMatchObject({ id: "proj-1" });
  });

  it("runDeliverableCreate plans then creates", async () => {
    const input = { name: "Landing page", funnel_stage: "TOP" };
    const planJson = await runners.runDeliverableCreate({
      json: true,
      campaignId: "proj-1",
      input,
      whatIf: true,
    });
    expect(planJson).toMatchObject({ plan: input });
    await runners.runDeliverableCreate({ quiet: true, campaignId: "proj-1", input, whatIf: true });

    vi.mocked(deliverablesApi.createDeliverable).mockResolvedValue({
      id: "d9",
      name: "Landing page",
    } as never);
    const createdJson = await runners.runDeliverableCreate({
      json: true,
      campaignId: "proj-1",
      input,
    });
    expect(createdJson).toMatchObject({ id: "d9" });
    expect(vi.mocked(deliverablesApi.createDeliverable)).toHaveBeenCalledWith(
      client,
      "proj-1",
      input
    );
    const createdHuman = await runners.runDeliverableCreate({
      quiet: true,
      campaignId: "proj-1",
      input,
    });
    expect(createdHuman).toMatchObject({ id: "d9" });
  });

  it("runTaskCreate plans then creates", async () => {
    const input = { name: "Draft copy" };
    const planJson = await runners.runTaskCreate({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      input,
      whatIf: true,
    });
    expect(planJson).toMatchObject({ plan: input });
    await runners.runTaskCreate({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      input,
      whatIf: true,
    });

    vi.mocked(tasksApi.createTask).mockResolvedValue(makeTask() as never);
    const createdJson = await runners.runTaskCreate({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      input,
    });
    expect(createdJson).toMatchObject({ id: "task-1" });
    expect(vi.mocked(tasksApi.createTask)).toHaveBeenCalledWith(client, "proj-1", "d1", input);
    const createdHuman = await runners.runTaskCreate({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      input,
    });
    expect(createdHuman).toMatchObject({ id: "task-1" });
  });

  it("runTaskUpdate plans then PUT-replaces", async () => {
    const input = { name: "Updated" };
    const planJson = await runners.runTaskUpdate({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
      input,
      whatIf: true,
    });
    expect(planJson).toMatchObject({ plan: { id: "task-1", input } });
    await runners.runTaskUpdate({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
      input,
      whatIf: true,
    });

    vi.mocked(tasksApi.updateTask).mockResolvedValue(makeTask() as never);
    const updatedJson = await runners.runTaskUpdate({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
      input,
    });
    expect(updatedJson).toMatchObject({ id: "task-1" });
    expect(vi.mocked(tasksApi.updateTask)).toHaveBeenCalledWith(
      client,
      "proj-1",
      "d1",
      "task-1",
      input
    );
    const updatedHuman = await runners.runTaskUpdate({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
      input,
    });
    expect(updatedHuman).toMatchObject({ id: "task-1" });
  });

  it("runCampaignDelete plans then deletes", async () => {
    const planJson = await runners.runCampaignDelete({
      json: true,
      campaignId: "proj-1",
      whatIf: true,
    });
    expect(planJson).toMatchObject({ deleted: false });
    await runners.runCampaignDelete({ quiet: true, campaignId: "proj-1", whatIf: true });
    expect(vi.mocked(projectsApi.deleteProject)).not.toHaveBeenCalled();

    vi.mocked(projectsApi.deleteProject).mockResolvedValue(undefined as never);
    const deletedJson = await runners.runCampaignDelete({ json: true, campaignId: "proj-1" });
    expect(deletedJson).toEqual({ id: "proj-1", deleted: true });
    const deletedHuman = await runners.runCampaignDelete({ quiet: true, campaignId: "proj-1" });
    expect(deletedHuman).toEqual({ id: "proj-1", deleted: true });
  });

  it("runDeliverableDelete plans then deletes", async () => {
    const planJson = await runners.runDeliverableDelete({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      whatIf: true,
    });
    expect(planJson).toMatchObject({ deleted: false });
    await runners.runDeliverableDelete({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      whatIf: true,
    });

    vi.mocked(deliverablesApi.deleteDeliverable).mockResolvedValue(undefined as never);
    const deletedJson = await runners.runDeliverableDelete({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
    });
    expect(deletedJson).toEqual({ id: "d1", deleted: true });
    const deletedHuman = await runners.runDeliverableDelete({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
    });
    expect(deletedHuman).toEqual({ id: "d1", deleted: true });
  });

  it("runTaskDelete plans then deletes", async () => {
    const planJson = await runners.runTaskDelete({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
      whatIf: true,
    });
    expect(planJson).toMatchObject({ deleted: false });
    await runners.runTaskDelete({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
      whatIf: true,
    });

    vi.mocked(tasksApi.deleteTask).mockResolvedValue(undefined as never);
    const deletedJson = await runners.runTaskDelete({
      json: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
    });
    expect(deletedJson).toEqual({ id: "task-1", deleted: true });
    const deletedHuman = await runners.runTaskDelete({
      quiet: true,
      campaignId: "proj-1",
      deliverableId: "d1",
      taskId: "task-1",
    });
    expect(deletedHuman).toEqual({ id: "task-1", deleted: true });
  });
});
