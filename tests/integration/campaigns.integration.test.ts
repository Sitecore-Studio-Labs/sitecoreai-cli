/**
 * Contract-pinned integration coverage for the `./unstable/campaigns`
 * SDK surface — Sitecore Orchestrate API (project + deliverable + task
 * resources). The wire shape is HAR-derived (2026-05-15) and stays
 * unverified in places (DELETE on every resource was inferred from
 * REST conventions, not captured). These tests pin the inferred shape
 * so regressions show up here rather than at runtime.
 *
 * Hermetic: `fetch` is stubbed, no live HTTP is made. Lives in the
 * integration tier because it pins **multi-resource lifecycle
 * workflows** (project → deliverable → task → cleanup) instead of
 * per-function transport details already covered by unit tests.
 *
 * Gated by `SITECOREAI_RUN_INTEGRATION=1`; skipped otherwise.
 */

import "./setup";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { createProject, deleteProject, listProjects } from "../../src/campaigns/api/projects";
import { createDeliverable, deleteDeliverable } from "../../src/campaigns/api/deliverables";
import { createTask, deleteTask, updateTask } from "../../src/campaigns/api/tasks";
import { DEFAULT_CAMPAIGN_API_BASE } from "../../src/campaigns/api/types";
import { describeIfIntegration } from "./helpers";

const { describe, it } = describeIfIntegration();

const B = DEFAULT_CAMPAIGN_API_BASE;
const baseClient = { accessToken: "campaign-token" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
  headers: Record<string, string>;
}

const recordCalls = (
  responses: Response[]
): { fetchMock: ReturnType<typeof vi.fn>; calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn().mockImplementation((url: string, init: unknown) => {
    const i = init as { method?: string; body?: string; headers?: Record<string, string> };
    calls.push({
      url,
      method: (i.method ?? "GET").toUpperCase(),
      body: i.body ? JSON.parse(i.body) : undefined,
      headers: i.headers ?? {},
    });
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected extra fetch call");
    }
    return Promise.resolve(next);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
};

describe("campaigns — full lifecycle: project + deliverable + task + cleanup", () => {
  it("issues the documented sequence of REST calls with bearer auth and snake_case bodies", async () => {
    const projectId = "proj-int-1";
    const deliverableId = "del-int-1";
    const taskId = "task-int-1";

    const { calls } = recordCalls([
      jsonResponse({ id: projectId, name: "Q3 Launch", status: "NOT_STARTED" }, 201),
      jsonResponse({ id: deliverableId, project_id: projectId, name: "Landing page" }, 201),
      jsonResponse(
        {
          id: taskId,
          project_id: projectId,
          project_deliverable_id: deliverableId,
          name: "Draft copy",
          status: "NOT_STARTED",
        },
        201
      ),
      jsonResponse({
        id: taskId,
        project_id: projectId,
        project_deliverable_id: deliverableId,
        name: "Final copy",
        status: "IN_PROGRESS",
      }),
      jsonResponse(null, 204),
      jsonResponse(null, 204),
      jsonResponse(null, 204),
    ]);

    const project = await createProject(baseClient, { name: "Q3 Launch" });
    expect(project.id).toBe(projectId);

    const deliverable = await createDeliverable(baseClient, projectId, {
      name: "Landing page",
      funnel_stage: "TOP",
    });
    expect(deliverable.id).toBe(deliverableId);

    const task = await createTask(baseClient, projectId, deliverableId, { name: "Draft copy" });
    expect(task.id).toBe(taskId);

    await updateTask(baseClient, projectId, deliverableId, taskId, {
      name: "Final copy",
      status: "IN_PROGRESS",
    });

    // Reverse-order cleanup — DELETE on every resource is UNVERIFIED upstream;
    // these calls pin the assumed REST shape so we notice if the API diverges.
    await deleteTask(baseClient, projectId, deliverableId, taskId);
    await deleteDeliverable(baseClient, projectId, deliverableId);
    await deleteProject(baseClient, projectId);

    // -- Wire-level contract assertions ------------------------------------

    // createProject
    expect(calls[0]).toMatchObject({
      url: `${B}/api/orchestrate/v1/projects`,
      method: "POST",
    });
    expect(calls[0].body).toMatchObject({
      name: "Q3 Launch",
      description: "",
      status: "NOT_STARTED",
      labels: [],
      members: [],
    });
    expect(calls[0].headers.Authorization).toBe("Bearer campaign-token");

    // createDeliverable
    expect(calls[1]).toMatchObject({
      url: `${B}/api/orchestrate/v1/projects/${projectId}/deliverables`,
      method: "POST",
    });
    expect(calls[1].body).toMatchObject({
      name: "Landing page",
      project_id: projectId,
      funnel_stage: "TOP",
      status: "NOT_STARTED",
      funnel_tactics: [],
      labels: [],
    });

    // createTask
    expect(calls[2]).toMatchObject({
      url: `${B}/api/orchestrate/v1/projects/${projectId}/deliverables/${deliverableId}/tasks`,
      method: "POST",
    });
    expect(calls[2].body).toMatchObject({
      project_id: projectId,
      project_deliverable_id: deliverableId,
      name: "Draft copy",
      status: "NOT_STARTED",
      archived: false,
      dependencies: [],
    });

    // updateTask — PUT is full-replacement; null defaults must be present.
    expect(calls[3]).toMatchObject({
      url: `${B}/api/orchestrate/v1/projects/${projectId}/deliverables/${deliverableId}/tasks/${taskId}`,
      method: "PUT",
    });
    expect(calls[3].body).toMatchObject({
      project_id: projectId,
      project_deliverable_id: deliverableId,
      name: "Final copy",
      status: "IN_PROGRESS",
      priority: null,
      description: null,
      assignee: null,
      labels: [],
      dependencies: [],
      archived: false,
    });

    // DELETEs — no body, item path under the create endpoint.
    expect(calls[4]).toMatchObject({
      url: `${B}/api/orchestrate/v1/projects/${projectId}/deliverables/${deliverableId}/tasks/${taskId}`,
      method: "DELETE",
    });
    expect(calls[4].body).toBeUndefined();
    expect(calls[5]).toMatchObject({
      url: `${B}/api/orchestrate/v1/projects/${projectId}/deliverables/${deliverableId}`,
      method: "DELETE",
    });
    expect(calls[6]).toMatchObject({
      url: `${B}/api/orchestrate/v1/projects/${projectId}`,
      method: "DELETE",
    });
  });
});

describe("campaigns — paging + scope-failure surface", () => {
  it("lists projects with pageSize and threads bearer auth", async () => {
    const { calls } = recordCalls([
      jsonResponse({ data: [{ id: "p1" }, { id: "p2" }], next: null, totalCount: 2 }),
    ]);

    const result = await listProjects(baseClient, { limit: 25 });

    expect(result.data).toHaveLength(2);
    expect(calls[0].url).toBe(`${B}/api/orchestrate/v1/projects?pageSize=25`);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer campaign-token");
  });

  it("surfaces a 403 with WWW-Authenticate as CAMPAIGN_API_FAILED with the missing scope in the hint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Insufficient scope" }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate":
            'Bearer error="insufficient_scope", scope="orchestrate.projects:read"',
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjects(baseClient)).rejects.toMatchObject({
      code: "CAMPAIGN_API_FAILED",
      hint: expect.stringContaining("orchestrate.projects:read"),
    });
  });
});
