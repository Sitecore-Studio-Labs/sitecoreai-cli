import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/publishing/api/auth", () => ({
  acquirePublishingToken: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/client", () => ({
  getPublishJob: vi.fn(),
  listPublishJobs: vi.fn(),
}));
vi.mock("../../../../src/publishing/job-watcher", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/publishing/job-watcher")>(
    "../../../../src/publishing/job-watcher"
  );
  return {
    ...actual,
    watchPublishJob: vi.fn(),
    printJobSummary: vi.fn(),
    throwOnTerminalFailure: vi.fn(),
  };
});

import { runPublishStatus } from "../../../../src/publishing/tasks/status";
import { resolveEnvironment } from "../../../../src/policy/environment";
import { acquirePublishingToken } from "../../../../src/publishing/api/auth";
import { getPublishJob, listPublishJobs } from "../../../../src/publishing/api/client";
import {
  watchPublishJob,
  printJobSummary,
  throwOnTerminalFailure,
} from "../../../../src/publishing/job-watcher";

let stdout: ReturnType<typeof vi.spyOn>;

const setupEnv = (): void => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  setupEnv();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(acquirePublishingToken).mockResolvedValue("test-token");
});

afterEach(() => {
  stdout.mockRestore();
});

/** Last JSON document written to stdout. */
const jsonOut = (): unknown => JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null"));

describe("runPublishStatus — input validation", () => {
  it("throws INPUT_INVALID when --watch is set without a jobId", async () => {
    await expect(runPublishStatus({ watch: true, json: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(vi.mocked(getPublishJob)).not.toHaveBeenCalled();
  });
});

describe("runPublishStatus — single job lookup", () => {
  it("fetches one job and prints its JSON in --json mode", async () => {
    vi.mocked(getPublishJob).mockResolvedValue({
      id: "job-1",
      state: "Running",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishStatus({ jobId: "job-1", json: true });

    expect(vi.mocked(getPublishJob)).toHaveBeenCalledWith(
      { accessToken: "test-token", timeoutMs: undefined },
      "job-1"
    );
    expect(jsonOut()).toMatchObject({ id: "job-1", state: "Running" });
    expect(vi.mocked(printJobSummary)).not.toHaveBeenCalled();
  });

  it("prints a human summary for one job when --json is off", async () => {
    vi.mocked(getPublishJob).mockResolvedValue({
      id: "job-1",
      state: "Running",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishStatus({ jobId: "job-1", quiet: true });

    expect(vi.mocked(printJobSummary)).toHaveBeenCalledOnce();
  });
});

describe("runPublishStatus — watch mode", () => {
  it("watches the job to terminal, prints JSON, and checks for terminal failure", async () => {
    vi.mocked(watchPublishJob).mockResolvedValue({
      id: "job-1",
      state: "Complete",
      canCancel: false,
      raw: {},
    } as never);

    await runPublishStatus({ jobId: "job-1", watch: true, json: true });

    expect(vi.mocked(watchPublishJob)).toHaveBeenCalledOnce();
    expect(vi.mocked(getPublishJob)).not.toHaveBeenCalled();
    expect(vi.mocked(throwOnTerminalFailure)).toHaveBeenCalledOnce();
    expect(jsonOut()).toMatchObject({ terminal: true, state: "Complete" });
  });

  it("prints a human summary when watching with --json off", async () => {
    vi.mocked(watchPublishJob).mockResolvedValue({
      id: "job-1",
      state: "Complete",
      canCancel: false,
      raw: {},
    } as never);

    await runPublishStatus({ jobId: "job-1", watch: true, quiet: true });

    expect(vi.mocked(printJobSummary)).toHaveBeenCalledOnce();
    expect(vi.mocked(throwOnTerminalFailure)).toHaveBeenCalledOnce();
  });

  it("clamps the poll interval before passing it to the watcher", async () => {
    vi.mocked(watchPublishJob).mockResolvedValue({
      id: "job-1",
      state: "Complete",
      canCancel: false,
      raw: {},
    } as never);

    await runPublishStatus({ jobId: "job-1", watch: true, json: true, pollIntervalS: 999 });

    // clampPollInterval caps at 60.
    expect(vi.mocked(watchPublishJob).mock.calls[0][3]).toBe(60);
  });
});

describe("runPublishStatus — list running jobs", () => {
  it("lists Queued + Running jobs and prints JSON when no jobId given", async () => {
    vi.mocked(listPublishJobs).mockResolvedValue([
      { id: "job-1", state: "Running", canCancel: true, raw: {} },
    ] as never);

    await runPublishStatus({ json: true });

    expect(vi.mocked(listPublishJobs)).toHaveBeenCalledWith(
      { accessToken: "test-token", timeoutMs: undefined },
      { statuses: ["Queued", "Running"] }
    );
    expect(jsonOut()).toMatchObject([{ id: "job-1" }]);
  });

  it("reports no running jobs in human mode when the list is empty", async () => {
    vi.mocked(listPublishJobs).mockResolvedValue([] as never);

    await runPublishStatus({ quiet: true });

    expect(vi.mocked(listPublishJobs)).toHaveBeenCalledOnce();
    expect(vi.mocked(printJobSummary)).not.toHaveBeenCalled();
  });
});
