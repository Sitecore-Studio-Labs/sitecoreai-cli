/**
 * Contract-pinned integration coverage for the `./unstable/publishing`
 * SDK surface. The wire shape of the SAI Publishing API (XM Cloud
 * publish jobs) is part of scai's external contract — library consumers
 * (CLI, MCP server, agent SDKs) depend on `submitPublishJob` /
 * `getPublishJob` / `cancelPublishJob` / `listPublishJobs` matching the
 * documented REST surface at `edge-platform.sitecorecloud.io`.
 *
 * These tests are hermetic — `fetch` is stubbed so no live HTTP is made
 * — but live in the integration tier because they pin **end-to-end
 * library-shaped workflows** (submit → get → cancel) rather than
 * individual function-shape contracts already covered by unit tests.
 * Gated by `SITECOREAI_RUN_INTEGRATION=1`; skipped otherwise.
 */

import "./setup";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  cancelPublishJob,
  getPublishJob,
  listPublishJobs,
  submitPublishJob,
} from "../../src/publishing/api/client";
import type { CreatePublishJobRequest, PublishJobResponse } from "../../src/publishing/api/types";
import { describeIfIntegration } from "./helpers";

const { describe, it } = describeIfIntegration();

const PUBLISHING_API = "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs";
const baseClient = { accessToken: "test-publishing-token" };

const sampleJob = (overrides: Partial<PublishJobResponse> = {}): PublishJobResponse => ({
  id: "job_42",
  name: "scai publish",
  description: null,
  source: "scai",
  options: { items: [{ id: "abc-123", type: "item" }] },
  statistics: { itemsProcessed: 8, itemsSent: 10 },
  system: {
    tenantId: "tenant-int",
    status: "Running",
    queuedTime: "2026-05-21T10:00:00Z",
    startTime: "2026-05-21T10:00:01Z",
    finishTime: null,
    createdBy: { id: "user-1", name: "Liz" },
  },
  permissions: { canViewDetails: true, canCancel: true },
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishing — submit + get + cancel round trip", () => {
  it("submits a Tier 1 item-publish job and normalizes the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleJob(), 201));
    vi.stubGlobal("fetch", fetchMock);

    const request: CreatePublishJobRequest = {
      name: "scai publish integration",
      source: "scai",
      options: {
        items: [{ id: "abc-123", type: "item" }],
        xmc: { items: { mode: "Smart" }, locales: ["en-US"] },
      },
    };
    const job = await submitPublishJob(baseClient, request);

    // Wire-level contract: URL + method + auth header + body shape.
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(PUBLISHING_API);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-publishing-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Accept).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(request);

    // Normalized job shape — the public SDK contract.
    expect(job).toMatchObject({
      id: "job_42",
      state: "running",
      source: "scai",
      processedCount: 8,
      totalCount: 10,
      // canCancel = permission AND state-is-cancellable; Running is.
      canCancel: true,
    });
    expect(job.raw).toBeDefined();
  });

  it("submits a Tier 2 whole-environment publish with xmc.site mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(sampleJob({ system: { ...sampleJob().system, status: "Queued" } }), 201)
      );
    vi.stubGlobal("fetch", fetchMock);

    const request: CreatePublishJobRequest = {
      name: "publish all",
      source: "scai",
      options: { xmc: { site: { mode: "Smart" }, locales: ["en-US", "fr-CA"] } },
    };
    const job = await submitPublishJob(baseClient, request);

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as CreatePublishJobRequest;
    expect(body.options.xmc?.site?.mode).toBe("Smart");
    expect(body.options.xmc?.locales).toEqual(["en-US", "fr-CA"]);
    expect(body.options.items).toBeUndefined();
    expect(job.state).toBe("queued");
  });

  it("reads back a submitted job by id with URL encoding", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleJob({ id: "job/with slash" })));
    vi.stubGlobal("fetch", fetchMock);

    const job = await getPublishJob(baseClient, "job/with slash");

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(`${PUBLISHING_API}/job%2Fwith%20slash`);
    expect(init.method).toBe("GET");
    expect(job.id).toBe("job/with slash");
  });

  it("cancels a job with POST /{id}/cancel and accepts a 202 no-content response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelPublishJob(baseClient, "job_42")).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body?: string }];
    expect(url).toBe(`${PUBLISHING_API}/job_42/cancel`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });
});

describe("publishing — listPublishJobs paging contract", () => {
  it("encodes repeated status filters and unwraps `{ data: [...] }` paging", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        totalCount: 2,
        pageNumber: 1,
        pageSize: 50,
        data: [
          sampleJob({ id: "j1" }),
          sampleJob({ id: "j2", system: { ...sampleJob().system, status: "Completed" } }),
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await listPublishJobs(baseClient, {
      statuses: ["Queued", "Running"],
      pageSize: 50,
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("system.status=Queued");
    expect(url).toContain("system.status=Running");
    expect(url).toContain("pageSize=50");

    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id)).toEqual(["j1", "j2"]);
    expect(jobs[1].state).toBe("completed");
    // Completed jobs report canCancel=false even when the permission flag is true.
    expect(jobs[1].canCancel).toBe(false);
  });
});

describe("publishing — auth + error mapping at the wire boundary", () => {
  it("maps 403 to AUTH_REQUIRED with a hint that names the missing scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitPublishJob(baseClient, {
        name: "x",
        source: "scai",
        options: {},
      })
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      hint: expect.stringContaining("xmcpub.jobs.t"),
    });
  });
});
