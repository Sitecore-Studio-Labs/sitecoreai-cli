/**
 * `src/agents/api/catalog.ts` — ancillary cross-cutting read endpoints
 * (scheduled runs, jobs, brand kits).
 *
 * The transport (`agentsRequest`) is mocked — exercised directly in
 * `request.test.ts` — so each catalog reader's request path and its
 * array / envelope / non-array response coercion can be asserted in
 * isolation, matching the pattern in `widgets.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsSession } from "../../../../src/agents/session/types";

vi.mock("../../../../src/agents/api/request", () => ({
  agentsRequest: vi.fn(),
}));

let catalog: typeof import("../../../../src/agents/api/catalog");
let request: typeof import("../../../../src/agents/api/request");

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

beforeAll(async () => {
  catalog = await import("../../../../src/agents/api/catalog");
  request = await import("../../../../src/agents/api/request");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listScheduledRuns", () => {
  it("returns a bare array response as-is", async () => {
    const runs = [{ id: "r-1" }, { id: "r-2" }];
    vi.mocked(request.agentsRequest).mockResolvedValue(runs as never);

    const result = await catalog.listScheduledRuns(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/scheduled-runs");
    expect(result).toEqual(runs);
  });

  it("unwraps a { schedules } envelope", async () => {
    const runs = [{ id: "r-1" }];
    vi.mocked(request.agentsRequest).mockResolvedValue({ schedules: runs } as never);

    expect(await catalog.listScheduledRuns(session)).toEqual(runs);
  });

  it("coerces a { schedules } envelope with a non-array value to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ schedules: "nope" } as never);
    expect(await catalog.listScheduledRuns(session)).toEqual([]);
  });

  it("coerces a null response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await catalog.listScheduledRuns(session)).toEqual([]);
  });
});

describe("listJobs", () => {
  it("returns a bare array response as-is", async () => {
    const jobs = [{ id: "j-1" }, { id: "j-2" }];
    vi.mocked(request.agentsRequest).mockResolvedValue(jobs as never);

    const result = await catalog.listJobs(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/jobs");
    expect(result).toEqual(jobs);
  });

  it("unwraps a { jobs } envelope", async () => {
    const jobs = [{ id: "j-9" }];
    vi.mocked(request.agentsRequest).mockResolvedValue({ jobs } as never);

    expect(await catalog.listJobs(session)).toEqual(jobs);
  });

  it("coerces a { jobs } envelope with a non-array value to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ jobs: 42 } as never);
    expect(await catalog.listJobs(session)).toEqual([]);
  });

  it("coerces an unrelated object response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ unexpected: true } as never);
    expect(await catalog.listJobs(session)).toEqual([]);
  });
});

describe("listBrandKits", () => {
  it("returns a bare array response as-is", async () => {
    const kits = [{ id: "bk-1" }];
    vi.mocked(request.agentsRequest).mockResolvedValue(kits as never);

    const result = await catalog.listBrandKits(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/brand-kits");
    expect(result).toEqual(kits);
  });

  it("coerces a non-array response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ kits: [] } as never);
    expect(await catalog.listBrandKits(session)).toEqual([]);
  });

  it("coerces a null response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await catalog.listBrandKits(session)).toEqual([]);
  });
});
