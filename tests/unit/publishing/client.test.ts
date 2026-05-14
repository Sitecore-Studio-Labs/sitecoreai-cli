import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublishJob, listPublishJobs } from "../../../src/publishing/sitecore-api/client";
import { ScaiError } from "../../../src/shared/errors";

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const errResponse = (status: number, body = ""): Response => new Response(body, { status });

const baseClient = { accessToken: "test-token" };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishing/client.getPublishJob", () => {
  it("hits the documented endpoint with the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "job_1", state: "running" }));
    vi.stubGlobal("fetch", fetchMock);

    const job = await getPublishJob(baseClient, "job_1");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    const fetchInit = init as { method: string; headers: Record<string, string> };
    expect(url).toBe("https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs/job_1");
    expect(fetchInit.method).toBe("GET");
    expect(fetchInit.headers).toMatchObject({
      Authorization: "Bearer test-token",
      Accept: "application/json",
    });
    expect(job).toEqual({
      id: "job_1",
      state: "running",
      processedCount: undefined,
      totalCount: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });
  });

  it("normalizes 'canceled' → 'cancelled' and uppercase states", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ id: "j", state: "Canceled" })));
    expect((await getPublishJob(baseClient, "j")).state).toBe("cancelled");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ id: "j", state: "COMPLETED" })));
    expect((await getPublishJob(baseClient, "j")).state).toBe("completed");
  });

  it("falls back to 'queued' for unknown state values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ id: "j", state: "mystery" })));
    expect((await getPublishJob(baseClient, "j")).state).toBe("queued");
  });

  it("reads alternate id fields (jobId)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ jobId: "j2", state: "running" })));
    expect((await getPublishJob(baseClient, "j2")).id).toBe("j2");
  });

  it("URL-encodes the jobId path segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "x", state: "queued" }));
    vi.stubGlobal("fetch", fetchMock);
    await getPublishJob(baseClient, "weird id/with slashes");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/jobs/weird%20id%2Fwith%20slashes");
  });

  it("rejects empty jobId before hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPublishJob(baseClient, "")).rejects.toBeInstanceOf(ScaiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces non-2xx as a NETWORK ScaiError with upstream body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errResponse(404, "Job not found")));
    await expect(getPublishJob(baseClient, "missing")).rejects.toMatchObject({
      code: "NETWORK",
      hint: "Job not found",
    });
  });

  it("honors a baseUrl override (for tests / mock servers)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "j", state: "queued" }));
    vi.stubGlobal("fetch", fetchMock);
    await getPublishJob({ ...baseClient, baseUrl: "https://mock.example" }, "j");
    expect(fetchMock.mock.calls[0][0]).toBe("https://mock.example/authoring/publishing/v1/jobs/j");
  });
});

describe("publishing/client.listPublishJobs", () => {
  it("returns all running/queued jobs by default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okJson([
  it("maps 403 to AUTH_REQUIRED with a scope-specific hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errResponse(403, "Forbidden"))
    );
    await expect(getPublishJob(baseClient, "j")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      hint: expect.stringContaining("publishing scopes"),
    });
  });

  it("maps 401 to AUTH_REQUIRED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errResponse(401, "Unauthorized"))
    );
    await expect(getPublishJob(baseClient, "j")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

          { id: "a", state: "running" },
          { id: "b", state: "queued" },
          { id: "c", state: "completed" },
          { id: "d", state: "failed" },
        ])
      )
    );
    const jobs = await listPublishJobs(baseClient);
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("accepts an explicit state filter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okJson([
          { id: "a", state: "running" },
          { id: "b", state: "completed" },
          { id: "c", state: "failed" },
        ])
      )
    );
    const jobs = await listPublishJobs(baseClient, { states: ["completed", "failed"] });
    expect(jobs.map((j) => j.id)).toEqual(["b", "c"]);
  });

  it("returns the full list when states is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okJson([
          { id: "a", state: "running" },
          { id: "b", state: "completed" },
        ])
      )
    );
    const jobs = await listPublishJobs(baseClient, { states: [] });
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("unwraps { items: [...] } pagination envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson({ items: [{ id: "a", state: "running" }] }))
    );
    const jobs = await listPublishJobs(baseClient);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("a");
  });

  it("unwraps { data: [...] } pagination envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson({ data: [{ id: "a", state: "queued" }] }))
    );
    const jobs = await listPublishJobs(baseClient);
    expect(jobs.map((j) => j.id)).toEqual(["a"]);
  });

  it("returns an empty list when the response shape is unrecognized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ surprise: 1 })));
    expect(await listPublishJobs(baseClient)).toEqual([]);
  });
});
