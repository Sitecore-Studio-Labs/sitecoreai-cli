import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/brief/client", () => ({
  resolveBriefClient: vi.fn(),
}));
vi.mock("../../../../src/brief/api/briefs", () => ({
  listBriefs: vi.fn(),
  getBrief: vi.fn(),
  createBrief: vi.fn(),
  updateBrief: vi.fn(),
  setBriefStatus: vi.fn(),
  deleteBrief: vi.fn(),
}));
vi.mock("../../../../src/brief/api/brief-types", () => ({
  createBriefType: vi.fn(),
  deleteBriefType: vi.fn(),
  getBriefType: vi.fn(),
  listBriefTypes: vi.fn(),
  updateBriefType: vi.fn(),
}));
vi.mock("../../../../src/brief/api/tasks", () => ({
  listBriefTasks: vi.fn(),
}));
vi.mock("../../../../src/brief/api/comments", () => ({
  listBriefComments: vi.fn(),
  createBriefComment: vi.fn(),
}));

import * as runners from "../../../../src/brief/tasks/index";
import { resolveBriefClient } from "../../../../src/brief/client";
import * as briefsApi from "../../../../src/brief/api/briefs";
import * as typesApi from "../../../../src/brief/api/brief-types";
import * as tasksApi from "../../../../src/brief/api/tasks";
import * as commentsApi from "../../../../src/brief/api/comments";

const client = { accessToken: "test-token", baseUrl: "https://co-brief-api-eus.example" };

const makeBrief = (overrides: Record<string, unknown> = {}) => ({
  id: "brief-1",
  name: "Spring Launch",
  status: "Draft",
  locale: "en",
  briefType: { id: "bt-1" },
  isTemplate: false,
  tasks: [],
  comments: [],
  references: [],
  createdOn: "2026-01-01",
  updatedOn: "2026-01-02",
  ...overrides,
});

const makeBriefType = (overrides: Record<string, unknown> = {}) => ({
  id: "bt-1",
  name: "Campaign Brief",
  label: { en: "Campaign Brief" },
  icon: "rocket",
  iconColor: "blue",
  description: "A brief type",
  fields: [{ name: "Goal", type: "text", required: true, aiEditable: false }],
  createdOn: "2026-01-01",
  updatedOn: "2026-01-02",
  ...overrides,
});

const page = (data: unknown[]) => ({ data, next: null, totalCount: data.length });

let stdout: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(resolveBriefClient).mockResolvedValue({ client, envName: "test" } as never);
});

afterEach(() => {
  stdout.mockRestore();
});

/** Last JSON document written to stdout by a runner in --json mode. */
const jsonOut = (): unknown => JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null"));

describe("brief runners — read verbs", () => {
  it("runBriefList prints JSON in --json mode", async () => {
    vi.mocked(briefsApi.listBriefs).mockResolvedValue(page([makeBrief()]) as never);

    const result = await runners.runBriefList({ json: true, limit: 5, locale: "en" });

    expect(result.totalCount).toBe(1);
    expect(vi.mocked(briefsApi.listBriefs)).toHaveBeenCalledWith(client, {
      limit: 5,
      locale: "en",
    });
    expect(jsonOut()).toMatchObject({ totalCount: 1 });
  });

  it("runBriefList renders a human table when briefs exist", async () => {
    vi.mocked(briefsApi.listBriefs).mockResolvedValue(page([makeBrief(), makeBrief()]) as never);

    const result = await runners.runBriefList({ quiet: true });

    expect(result.data).toHaveLength(2);
  });

  it("runBriefList reports an empty result in human mode", async () => {
    vi.mocked(briefsApi.listBriefs).mockResolvedValue(page([]) as never);

    const result = await runners.runBriefList({ quiet: true });

    expect(result.totalCount).toBe(0);
  });

  it("runBriefShow prints JSON in --json mode", async () => {
    vi.mocked(briefsApi.getBrief).mockResolvedValue(makeBrief() as never);

    await runners.runBriefShow({ json: true, briefId: "brief-1" });

    expect(vi.mocked(briefsApi.getBrief)).toHaveBeenCalledWith(client, "brief-1");
    expect(jsonOut()).toMatchObject({ id: "brief-1" });
  });

  it("runBriefShow renders human detail", async () => {
    vi.mocked(briefsApi.getBrief).mockResolvedValue(makeBrief() as never);

    const result = await runners.runBriefShow({ quiet: true, briefId: "brief-1" });

    expect(result.id).toBe("brief-1");
  });

  it("runBriefTypes prints JSON, the human table, and an empty result", async () => {
    vi.mocked(typesApi.listBriefTypes).mockResolvedValue(page([makeBriefType()]) as never);
    await runners.runBriefTypes({ json: true });
    expect(jsonOut()).toMatchObject({ totalCount: 1 });

    await runners.runBriefTypes({ quiet: true });

    vi.mocked(typesApi.listBriefTypes).mockResolvedValue(page([]) as never);
    const empty = await runners.runBriefTypes({ quiet: true });
    expect(empty.totalCount).toBe(0);
  });

  it("runBriefTypeGet prints JSON and human detail", async () => {
    vi.mocked(typesApi.getBriefType).mockResolvedValue(makeBriefType() as never);

    await runners.runBriefTypeGet({ json: true, briefTypeId: "bt-1" });
    expect(jsonOut()).toMatchObject({ id: "bt-1" });

    const result = await runners.runBriefTypeGet({ quiet: true, briefTypeId: "bt-1" });
    expect(result.fields).toHaveLength(1);
  });

  it("runBriefTodosList loads assignee metadata when requested", async () => {
    const todo = { id: "todo-1", title: "Write copy" };
    vi.mocked(tasksApi.listBriefTasks).mockResolvedValue(page([todo]) as never);

    await runners.runBriefTodosList({ json: true, briefId: "brief-1", assignees: true, limit: 3 });

    expect(vi.mocked(tasksApi.listBriefTasks)).toHaveBeenCalledWith(client, {
      briefId: "brief-1",
      metadataToLoad: ["assignees"],
      limit: 3,
    });
    expect(jsonOut()).toMatchObject({ totalCount: 1 });
  });

  it("runBriefTodosList renders rows and both empty messages", async () => {
    vi.mocked(tasksApi.listBriefTasks).mockResolvedValue(page([{ id: "t1" }]) as never);
    await runners.runBriefTodosList({ quiet: true });

    vi.mocked(tasksApi.listBriefTasks).mockResolvedValue(page([]) as never);
    await runners.runBriefTodosList({ quiet: true, briefId: "brief-1" });
    const noFilter = await runners.runBriefTodosList({ quiet: true });
    expect(noFilter.totalCount).toBe(0);
  });

  it("runBriefCommentsList prints JSON, rows, and both empty messages", async () => {
    vi.mocked(commentsApi.listBriefComments).mockResolvedValue(page([{ id: "c1" }]) as never);
    await runners.runBriefCommentsList({ json: true });
    expect(jsonOut()).toMatchObject({ totalCount: 1 });

    await runners.runBriefCommentsList({ quiet: true });

    vi.mocked(commentsApi.listBriefComments).mockResolvedValue(page([]) as never);
    await runners.runBriefCommentsList({ quiet: true, briefId: "brief-1" });
    const noFilter = await runners.runBriefCommentsList({ quiet: true });
    expect(noFilter.totalCount).toBe(0);
  });
});

describe("brief runners — write verbs honour --what-if", () => {
  it("runBriefSetStatus plans in --what-if and applies otherwise", async () => {
    const planJson = await runners.runBriefSetStatus({
      json: true,
      briefId: "brief-1",
      status: "InReview" as never,
      whatIf: true,
    });
    expect(planJson).toMatchObject({ plan: { id: "brief-1", status: "InReview" } });
    expect(vi.mocked(briefsApi.setBriefStatus)).not.toHaveBeenCalled();

    await runners.runBriefSetStatus({
      quiet: true,
      briefId: "brief-1",
      status: "Approved" as never,
      whatIf: true,
    });

    vi.mocked(briefsApi.setBriefStatus).mockResolvedValue(undefined as never);
    const appliedJson = await runners.runBriefSetStatus({
      json: true,
      briefId: "brief-1",
      status: "Approved" as never,
    });
    expect(appliedJson).toMatchObject({ id: "brief-1", status: "Approved" });
    expect(vi.mocked(briefsApi.setBriefStatus)).toHaveBeenCalledWith(client, "brief-1", "Approved");

    const appliedHuman = await runners.runBriefSetStatus({
      quiet: true,
      briefId: "brief-1",
      status: "Approved" as never,
    });
    expect(appliedHuman).toMatchObject({ status: "Approved" });
  });

  it("runBriefTypeCreate plans then applies", async () => {
    const input = { name: "New Type", label: { en: "New" }, description: "d", fields: [] };

    const planJson = await runners.runBriefTypeCreate({ json: true, input, whatIf: true });
    expect(planJson).toMatchObject({ plan: input });
    await runners.runBriefTypeCreate({ quiet: true, input, whatIf: true });
    expect(vi.mocked(typesApi.createBriefType)).not.toHaveBeenCalled();

    vi.mocked(typesApi.createBriefType).mockResolvedValue(makeBriefType() as never);
    const createdJson = await runners.runBriefTypeCreate({ json: true, input });
    expect(createdJson).toMatchObject({ id: "bt-1" });
    const createdHuman = await runners.runBriefTypeCreate({ quiet: true, input });
    expect(createdHuman).toMatchObject({ id: "bt-1" });
  });

  it("runBriefTypeUpdate plans then PUT-replaces", async () => {
    const input = { name: "Edited", label: { en: "Edited" }, description: "d", fields: [] };

    const planJson = await runners.runBriefTypeUpdate({
      json: true,
      briefTypeId: "bt-1",
      input,
      whatIf: true,
    });
    expect(planJson).toMatchObject({ plan: { id: "bt-1", input } });
    await runners.runBriefTypeUpdate({ quiet: true, briefTypeId: "bt-1", input, whatIf: true });

    vi.mocked(typesApi.updateBriefType).mockResolvedValue(undefined as never);
    const updatedJson = await runners.runBriefTypeUpdate({
      json: true,
      briefTypeId: "bt-1",
      input,
    });
    expect(updatedJson).toEqual({ id: "bt-1" });
    expect(vi.mocked(typesApi.updateBriefType)).toHaveBeenCalledWith(client, "bt-1", input);
    const updatedHuman = await runners.runBriefTypeUpdate({
      quiet: true,
      briefTypeId: "bt-1",
      input,
    });
    expect(updatedHuman).toEqual({ id: "bt-1" });
  });

  it("runBriefTypeDelete plans then deletes", async () => {
    const planJson = await runners.runBriefTypeDelete({
      json: true,
      briefTypeId: "bt-1",
      whatIf: true,
    });
    expect(planJson).toMatchObject({ deleted: false });
    await runners.runBriefTypeDelete({ quiet: true, briefTypeId: "bt-1", whatIf: true });
    expect(vi.mocked(typesApi.deleteBriefType)).not.toHaveBeenCalled();

    vi.mocked(typesApi.deleteBriefType).mockResolvedValue(undefined as never);
    const deletedJson = await runners.runBriefTypeDelete({ json: true, briefTypeId: "bt-1" });
    expect(deletedJson).toEqual({ id: "bt-1", deleted: true });
    const deletedHuman = await runners.runBriefTypeDelete({ quiet: true, briefTypeId: "bt-1" });
    expect(deletedHuman).toEqual({ id: "bt-1", deleted: true });
  });

  it("runBriefCreate plans then applies", async () => {
    const input = { name: "New Brief", briefTypeId: "bt-1", locale: "en-us" };

    const planJson = await runners.runBriefCreate({ json: true, input, whatIf: true });
    expect(planJson).toMatchObject({ plan: input });
    await runners.runBriefCreate({ quiet: true, input, whatIf: true });
    expect(vi.mocked(briefsApi.createBrief)).not.toHaveBeenCalled();

    vi.mocked(briefsApi.createBrief).mockResolvedValue(
      makeBrief({ id: "brief-99", name: "New Brief" }) as never
    );
    const createdJson = await runners.runBriefCreate({ json: true, input });
    expect(createdJson).toMatchObject({ id: "brief-99", name: "New Brief" });
    expect(vi.mocked(briefsApi.createBrief)).toHaveBeenCalledWith(client, input);
    const createdHuman = await runners.runBriefCreate({ quiet: true, input });
    expect(createdHuman).toMatchObject({ id: "brief-99" });
  });

  it("runBriefUpdate plans then PUT-patches", async () => {
    const patch = { name: "Renamed", status: "Approved" as never };

    const planJson = await runners.runBriefUpdate({
      json: true,
      briefId: "brief-1",
      patch,
      whatIf: true,
    });
    expect(planJson).toMatchObject({ plan: { id: "brief-1", patch } });
    expect(vi.mocked(briefsApi.updateBrief)).not.toHaveBeenCalled();

    vi.mocked(briefsApi.updateBrief).mockResolvedValue(undefined as never);
    const updatedJson = await runners.runBriefUpdate({
      json: true,
      briefId: "brief-1",
      patch,
    });
    expect(updatedJson).toEqual({ id: "brief-1" });
    expect(vi.mocked(briefsApi.updateBrief)).toHaveBeenCalledWith(client, "brief-1", patch);
    const updatedHuman = await runners.runBriefUpdate({
      quiet: true,
      briefId: "brief-1",
      patch,
    });
    expect(updatedHuman).toEqual({ id: "brief-1" });
  });

  it("runBriefDelete plans then deletes", async () => {
    const planJson = await runners.runBriefDelete({ json: true, briefId: "brief-1", whatIf: true });
    expect(planJson).toMatchObject({ deleted: false });
    await runners.runBriefDelete({ quiet: true, briefId: "brief-1", whatIf: true });

    vi.mocked(briefsApi.deleteBrief).mockResolvedValue(undefined as never);
    const deletedJson = await runners.runBriefDelete({ json: true, briefId: "brief-1" });
    expect(deletedJson).toEqual({ id: "brief-1", deleted: true });
    const deletedHuman = await runners.runBriefDelete({ quiet: true, briefId: "brief-1" });
    expect(deletedHuman).toEqual({ id: "brief-1", deleted: true });
  });

  it("runBriefCommentAdd plans then posts a comment", async () => {
    const planJson = await runners.runBriefCommentAdd({
      json: true,
      briefId: "brief-1",
      text: "looks good",
      whatIf: true,
    });
    expect(planJson).toMatchObject({ plan: { briefId: "brief-1", text: "looks good" } });
    await runners.runBriefCommentAdd({
      quiet: true,
      briefId: "brief-1",
      text: "looks good",
      whatIf: true,
    });
    expect(vi.mocked(commentsApi.createBriefComment)).not.toHaveBeenCalled();

    vi.mocked(commentsApi.createBriefComment).mockResolvedValue({ id: "c-9" } as never);
    const postedJson = await runners.runBriefCommentAdd({
      json: true,
      briefId: "brief-1",
      text: "ship it",
    });
    expect(postedJson).toMatchObject({ id: "c-9" });
    expect(vi.mocked(commentsApi.createBriefComment)).toHaveBeenCalledWith(client, {
      briefId: "brief-1",
      text: "ship it",
    });
    const postedHuman = await runners.runBriefCommentAdd({
      quiet: true,
      briefId: "brief-1",
      text: "ship it",
    });
    expect(postedHuman).toMatchObject({ id: "c-9" });
  });
});
