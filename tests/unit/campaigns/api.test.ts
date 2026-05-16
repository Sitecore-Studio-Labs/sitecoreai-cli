import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, getProject, listProjects } from "../../../src/campaigns/api/projects";
import { createDeliverable } from "../../../src/campaigns/api/deliverables";
import { createTask, getTask, listTasks, updateTask } from "../../../src/campaigns/api/tasks";
import { listUsers } from "../../../src/campaigns/api/users";
import { DEFAULT_CAMPAIGN_API_BASE } from "../../../src/campaigns/api/types";

const baseOptions = { accessToken: "test-token" };
const B = DEFAULT_CAMPAIGN_API_BASE;

const okResponse = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });

const emptyPage = { data: [], next: null, totalCount: 0 };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("campaign API — projects", () => {
  it("listProjects hits /api/orchestrate/v1/projects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listProjects(baseOptions);

    expect(fetchMock.mock.calls[0][0]).toBe(`${B}/api/orchestrate/v1/projects`);
  });

  it("listProjects threads limit through as pageSize", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listProjects(baseOptions, { limit: 20 });

    expect(fetchMock.mock.calls[0][0]).toContain("pageSize=20");
  });

  it("getProject URL-encodes the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "p1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getProject(baseOptions, "p1/with/slash");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${B}/api/orchestrate/v1/projects/p1%2Fwith%2Fslash`
    );
  });

  it("createProject POSTs a body with server-defaulted fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "new" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createProject(baseOptions, { name: "Spring Launch" });

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${B}/api/orchestrate/v1/projects`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      name: "Spring Launch",
      description: "",
      status: "NOT_STARTED",
      labels: [],
      members: [],
    });
  });
});

describe("campaign API — deliverables + tasks", () => {
  it("createDeliverable POSTs to the nested deliverables path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "d1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createDeliverable(baseOptions, "proj-1", { name: "Landing page", funnel_stage: "TOP" });

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${B}/api/orchestrate/v1/projects/proj-1/deliverables`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      name: "Landing page",
      project_id: "proj-1",
      funnel_stage: "TOP",
    });
  });

  it("listTasks hits the nested tasks path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listTasks(baseOptions, "proj-1", "del-1");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${B}/api/orchestrate/v1/projects/proj-1/deliverables/del-1/tasks`
    );
  });

  it("getTask hits the nested task item path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "t1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTask(baseOptions, "proj-1", "del-1", "task-1");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${B}/api/orchestrate/v1/projects/proj-1/deliverables/del-1/tasks/task-1`
    );
  });

  it("createTask POSTs with project + deliverable ids in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "t1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createTask(baseOptions, "proj-1", "del-1", { name: "Draft copy" });

    const [, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      project_id: "proj-1",
      project_deliverable_id: "del-1",
      name: "Draft copy",
      status: "NOT_STARTED",
    });
  });

  it("updateTask PUTs the full-replacement body to the item path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "task-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await updateTask(baseOptions, "proj-1", "del-1", "task-1", {
      name: "Updated",
      description: "<p>done</p>",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${B}/api/orchestrate/v1/projects/proj-1/deliverables/del-1/tasks/task-1`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toMatchObject({ name: "Updated", description: "<p>done</p>" });
  });
});

describe("campaign API — transport", () => {
  it("listUsers hits /api/orchestrate/v1/users", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listUsers(baseOptions);

    expect(fetchMock.mock.calls[0][0]).toBe(`${B}/api/orchestrate/v1/users`);
  });

  it("attaches the access token as a Bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listProjects({ accessToken: "the-token" });

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer the-token");
  });

  it("respects a regional baseUrl override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listProjects({
      accessToken: "t",
      baseUrl: "https://ai-workflows-eus.sitecorecloud.io",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://ai-workflows-eus.sitecorecloud.io/api/orchestrate/v1/projects"
    );
  });

  it("surfaces non-2xx responses as a thrown error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('"nope"', { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getProject(baseOptions, "missing")).rejects.toThrow();
  });
});
