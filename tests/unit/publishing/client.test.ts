import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelPublishJob,
  getPublishJob,
  listPublishJobs,
  submitPublishJob,
} from "../../../src/publishing/sitecore-api/client";
import { ScaiError } from "../../../src/shared/errors";
import type {
  CreatePublishJobRequest,
  PublishJobResponse,
} from "../../../src/publishing/sitecore-api/types";

const baseClient = { accessToken: "test-token" };

const sampleResponse = (overrides: Partial<PublishJobResponse> = {}): PublishJobResponse => ({
  id: "job_1",
  name: "test job",
  description: null,
  source: "scai",
  options: { items: [{ id: "item-1", type: "item" }] },
  statistics: { processedCount: 5, totalCount: 10 },
  system: {
    tenantId: "tenant-abc",
    status: "Running",
    queuedTime: "2026-05-14T10:00:00Z",
    startTime: "2026-05-14T10:00:01Z",
    finishTime: null,
    createdBy: { id: "user-1", name: "Liz" },
  },
  permissions: { canViewDetails: true, canCancel: true },
  ...overrides,
});

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const noContent = (status: 202 | 204): Response => new Response("", { status });

const errResponse = (status: number, body = ""): Response => new Response(body, { status });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishing/client.submitPublishJob", () => {
  it("POSTs to /jobs with the CreateJobRequest body and bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(sampleResponse(), 201));
    vi.stubGlobal("fetch", fetchMock);
    const req: CreatePublishJobRequest = {
      name: "my publish",
      source: "scai",
      options: { items: [{ id: "abc", type: "item" }] },
    };
    const job = await submitPublishJob(baseClient, req);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs"
    );
    const fetchInit = init as { method: string; body: string; headers: Record<string, string> };
    expect(fetchInit.method).toBe("POST");
    expect(JSON.parse(fetchInit.body)).toEqual(req);
    expect(fetchInit.headers.Authorization).toBe("Bearer test-token");
    expect(job.id).toBe("job_1");
    expect(job.state).toBe("running");
  });

  it("normalizes wire status to internal state union", async () => {
    for (const [wire, expected] of [
      ["Queued", "queued"],
      ["Running", "running"],
      ["Completed", "completed"],
      ["Failed", "failed"],
      ["Canceled", "cancelled"],
      ["Canceling", "cancelling"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          okJson(sampleResponse({ system: { ...sampleResponse().system, status: wire } }), 201)
        )
      );
      const job = await submitPublishJob(baseClient, {
        name: "x",
        source: "scai",
        options: {},
      });
      expect(job.state).toBe(expected);
    }
  });

  it("falls back to 'queued' for unknown wire status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okJson(
          sampleResponse({
            system: {
              ...sampleResponse().system,
              status: "Unknown" as unknown as PublishJobResponse["system"]["status"],
            },
          }),
          201
        )
      )
    );
    const job = await submitPublishJob(baseClient, { name: "x", source: "scai", options: {} });
    expect(job.state).toBe("queued");
  });

  it("surfaces 403 as AUTH_REQUIRED with scope-grant hint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errResponse(403, "Forbidden")));
    await expect(
      submitPublishJob(baseClient, { name: "x", source: "scai", options: {} })
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      hint: expect.stringContaining("xmcpub.jobs.t"),
    });
  });

  it("surfaces 401 as AUTH_REQUIRED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errResponse(401, "Unauthorized")));
    await expect(
      submitPublishJob(baseClient, { name: "x", source: "scai", options: {} })
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("surfaces 400 as NETWORK with body in hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          errResponse(400, '{"errors":{"Name":["The Name field is required."]}}')
        )
    );
    await expect(
      submitPublishJob(baseClient, { name: "", source: "", options: {} })
    ).rejects.toMatchObject({
      code: "NETWORK",
      hint: expect.stringContaining("Name field is required"),
    });
  });
});

describe("publishing/client.getPublishJob", () => {
  it("GETs /jobs/{id} and normalizes the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(sampleResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const job = await getPublishJob(baseClient, "job_1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs/job_1"
    );
    expect(job.processedCount).toBe(5);
    expect(job.totalCount).toBe(10);
    expect(job.canCancel).toBe(true);
  });

  it("URL-encodes the jobId path segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(sampleResponse()));
    vi.stubGlobal("fetch", fetchMock);
    await getPublishJob(baseClient, "id with/slashes");
    expect(fetchMock.mock.calls[0][0]).toContain("/jobs/id%20with%2Fslashes");
  });

  it("rejects empty jobId before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPublishJob(baseClient, "")).rejects.toBeInstanceOf(ScaiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("publishing/client.cancelPublishJob", () => {
  it("POSTs to /jobs/{id}/cancel with no body and accepts 202", async () => {
    const fetchMock = vi.fn().mockResolvedValue(noContent(202));
    vi.stubGlobal("fetch", fetchMock);
    await expect(cancelPublishJob(baseClient, "job_1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs/job_1/cancel"
    );
    const fetchInit = init as { method: string; body?: string };
    expect(fetchInit.method).toBe("POST");
    expect(fetchInit.body).toBeUndefined();
  });

  it("rejects empty jobId", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(cancelPublishJob(baseClient, "")).rejects.toBeInstanceOf(ScaiError);
  });
});

describe("publishing/client.listPublishJobs", () => {
  it("appends status filters as repeated query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listPublishJobs(baseClient, { statuses: ["Queued", "Running"], pageSize: 25 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("system.status=Queued");
    expect(url).toContain("system.status=Running");
    expect(url).toContain("pageSize=25");
  });

  it("unwraps offset-paging { data: [...] } responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          okJson({ totalCount: 1, pageNumber: 1, pageSize: 50, data: [sampleResponse()] })
        )
    );
    const jobs = await listPublishJobs(baseClient);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("job_1");
  });

  it("accepts a bare array response shape too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson([sampleResponse()])));
    const jobs = await listPublishJobs(baseClient);
    expect(jobs).toHaveLength(1);
  });

  it("returns empty when neither shape matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ unexpected: 1 })));
    expect(await listPublishJobs(baseClient)).toEqual([]);
  });
});
