import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../src/config/types";

vi.mock("../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../src/publishing/api/auth", () => ({
  acquirePublishingToken: vi.fn().mockResolvedValue("tok"),
}));
vi.mock("../../../src/publishing/api/client", () => ({
  cancelPublishJob: vi.fn(),
  getPublishJob: vi.fn(),
  listPublishJobs: vi.fn(),
}));
vi.mock("../../../src/shared/prompt", () => ({
  promptText: vi.fn(),
}));

import { runPublishCancel } from "../../../src/publishing/tasks/cancel";
import { resolveEnvironment } from "../../../src/policy/environment";
import {
  cancelPublishJob,
  getPublishJob,
  listPublishJobs,
} from "../../../src/publishing/api/client";
import { promptText } from "../../../src/shared/prompt";
import type { PublishJob } from "../../../src/publishing/api/types";

const mockResolveEnv = resolveEnvironment as unknown as ReturnType<typeof vi.fn>;
const mockCancel = cancelPublishJob as unknown as ReturnType<typeof vi.fn>;
const mockGetJob = getPublishJob as unknown as ReturnType<typeof vi.fn>;
const mockListJobs = listPublishJobs as unknown as ReturnType<typeof vi.fn>;
const mockPrompt = promptText as unknown as ReturnType<typeof vi.fn>;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-publish-cancel-test-"));
const auditPath = path.join(tmpRoot, "audit.log");

const setupEnv = () => {
  const env = { name: "sandbox", tenantId: "tenant-x" } as EnvironmentConfiguration;
  mockResolveEnv.mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
};

const makeJob = (overrides: Partial<PublishJob>): PublishJob => ({
  id: "job_a",
  state: "running",
  canCancel: true,
  raw: {
    id: "job_a",
    name: null,
    description: null,
    source: null,
    options: { xmc: { items: { mode: "Smart" } } },
    statistics: null,
    system: { tenantId: "tenant-x", status: "Running", createdBy: {} },
    permissions: { canViewDetails: true, canCancel: true },
  },
  ...overrides,
});

beforeEach(() => {
  mockResolveEnv.mockReset();
  mockCancel.mockReset();
  mockGetJob.mockReset();
  mockListJobs.mockReset();
  mockPrompt.mockReset();
  process.env.SITECOREAI_AUDIT_LOG = auditPath;
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SITECOREAI_AUDIT_LOG;
});

describe("runPublishCancel — single job", () => {
  it("cancels a single cancellable job", async () => {
    setupEnv();
    mockGetJob.mockResolvedValue(makeJob({ canCancel: true }));
    mockCancel.mockResolvedValue(undefined);
    await runPublishCancel({ jobId: "job_a", environmentName: "sandbox", quiet: true });
    expect(mockCancel).toHaveBeenCalledWith(expect.anything(), "job_a");
  });

  it("refuses to cancel a non-cancellable job", async () => {
    setupEnv();
    mockGetJob.mockResolvedValue(makeJob({ canCancel: false, state: "completed" }));
    await expect(
      runPublishCancel({ jobId: "job_a", environmentName: "sandbox", quiet: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe("runPublishCancel — --all-queued", () => {
  it("rejects when both jobId and --all-queued are passed", async () => {
    setupEnv();
    await expect(runPublishCancel({ jobId: "job_a", allQueued: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("no-ops with a friendly message when nothing is queued or running", async () => {
    setupEnv();
    mockListJobs.mockResolvedValue([]);
    await runPublishCancel({ allQueued: true, yes: true, quiet: true });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("cancels every queued/running job after a typed env-name confirmation", async () => {
    setupEnv();
    mockListJobs.mockResolvedValue([
      makeJob({ id: "job_a", canCancel: true }),
      makeJob({ id: "job_b", canCancel: true, state: "queued" }),
      makeJob({ id: "job_c", canCancel: true, state: "running" }),
    ]);
    mockCancel.mockResolvedValue(undefined);
    mockPrompt.mockResolvedValue("sandbox");
    await runPublishCancel({ allQueued: true, quiet: true });
    expect(mockCancel).toHaveBeenCalledTimes(3);
  });

  it("aborts when the typed env-name doesn't match", async () => {
    setupEnv();
    mockListJobs.mockResolvedValue([makeJob({ id: "job_a", canCancel: true })]);
    mockPrompt.mockResolvedValue("wrong-name");
    await expect(runPublishCancel({ allQueued: true, quiet: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("skips jobs that raced to terminal state between list and cancel (NOT_CANCELLABLE)", async () => {
    setupEnv();
    mockListJobs.mockResolvedValue([
      makeJob({ id: "job_a", canCancel: true }),
      makeJob({ id: "job_b", canCancel: false, state: "completed" }),
    ]);
    mockCancel.mockResolvedValue(undefined);
    await runPublishCancel({ allQueued: true, yes: true, quiet: true });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith(expect.anything(), "job_a");
  });

  it("--all-queued + non-interactive requires --yes", async () => {
    setupEnv();
    mockListJobs.mockResolvedValue([makeJob({ id: "job_a", canCancel: true })]);
    await expect(
      runPublishCancel({ allQueued: true, nonInteractive: true, quiet: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
