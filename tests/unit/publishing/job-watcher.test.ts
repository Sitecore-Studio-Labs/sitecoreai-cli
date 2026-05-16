import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../../src/shared/logger";

vi.mock("../../../src/publishing/api/client", () => ({
  getPublishJob: vi.fn(),
}));

import { getPublishJob } from "../../../src/publishing/api/client";
import {
  clampPollInterval,
  throwOnTerminalFailure,
  watchPublishJob,
} from "../../../src/publishing/job-watcher";
import type {
  PublishJob,
  PublishingApiClientOptions,
} from "../../../src/publishing/api/types";

const mockGetJob = getPublishJob as unknown as ReturnType<typeof vi.fn>;
const noopLogger = new Logger(false, false, false, true);
const client: PublishingApiClientOptions = { accessToken: "tok" };

const makeJob = (overrides: Partial<PublishJob>): PublishJob => ({
  id: "job_test",
  state: "queued",
  canCancel: false,
  raw: {
    id: "job_test",
    name: null,
    description: null,
    source: null,
    options: {},
    statistics: null,
    system: { tenantId: "t", status: "Queued", createdBy: {} },
    permissions: { canViewDetails: true, canCancel: false },
  },
  ...overrides,
});

beforeEach(() => {
  mockGetJob.mockReset();
  // Make sleep instant in tests.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("clampPollInterval", () => {
  it("clamps to [2, 60]", () => {
    expect(clampPollInterval(undefined)).toBe(5);
    expect(clampPollInterval(0)).toBe(2);
    expect(clampPollInterval(1)).toBe(2);
    expect(clampPollInterval(30)).toBe(30);
    expect(clampPollInterval(90)).toBe(60);
    expect(clampPollInterval(Number.NaN)).toBe(5);
  });
});

describe("watchPublishJob", () => {
  it("returns immediately when the first poll is already terminal", async () => {
    mockGetJob.mockResolvedValueOnce(makeJob({ state: "completed" }));
    const job = await watchPublishJob(noopLogger, client, "job_test", 2, 30);
    expect(job.state).toBe("completed");
    expect(mockGetJob).toHaveBeenCalledOnce();
  });

  it("polls until a terminal state is reached", async () => {
    mockGetJob
      .mockResolvedValueOnce(makeJob({ state: "queued" }))
      .mockResolvedValueOnce(makeJob({ state: "running" }))
      .mockResolvedValueOnce(makeJob({ state: "completed" }));

    const watchPromise = watchPublishJob(noopLogger, client, "job_test", 2, 30);
    // Advance through the two sleeps (2s each).
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    const job = await watchPromise;

    expect(job.state).toBe("completed");
    expect(mockGetJob).toHaveBeenCalledTimes(3);
  });

  it("throws NETWORK on timeout", async () => {
    mockGetJob.mockResolvedValue(makeJob({ state: "running" }));
    const watchPromise = watchPublishJob(noopLogger, client, "job_test", 2, 4);
    // Advance through the polls until we exceed the deadline.
    await vi.advanceTimersByTimeAsync(5000);
    await expect(watchPromise).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("Watch timed out"),
    });
  });
});

describe("throwOnTerminalFailure", () => {
  it("does not throw on completed", () => {
    expect(() => throwOnTerminalFailure(makeJob({ state: "completed" }))).not.toThrow();
  });

  it("throws DEPLOY_FAILED on failed", () => {
    expect(() => throwOnTerminalFailure(makeJob({ state: "failed" }))).toThrow(
      expect.objectContaining({ code: "DEPLOY_FAILED" })
    );
  });

  it("throws CANCELLED on cancelled", () => {
    expect(() => throwOnTerminalFailure(makeJob({ state: "cancelled" }))).toThrow(
      expect.objectContaining({ code: "CANCELLED" })
    );
  });
});
