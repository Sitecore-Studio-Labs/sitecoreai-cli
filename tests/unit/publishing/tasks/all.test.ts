import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/publishing/api/auth", () => ({
  acquirePublishingToken: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/client", () => ({
  submitPublishJob: vi.fn(),
  listPublishJobs: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/languages", () => ({
  resolvePublishingLocales: vi.fn(),
}));
vi.mock("../../../../src/shared/prompt", () => ({
  promptText: vi.fn(),
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

import { runPublishAll } from "../../../../src/publishing/tasks/all";
import { resolveEnvironment } from "../../../../src/policy/environment";
import { acquirePublishingToken } from "../../../../src/publishing/api/auth";
import { submitPublishJob, listPublishJobs } from "../../../../src/publishing/api/client";
import { resolvePublishingLocales } from "../../../../src/publishing/api/languages";
import { promptText } from "../../../../src/shared/prompt";
import {
  watchPublishJob,
  printJobSummary,
  throwOnTerminalFailure,
} from "../../../../src/publishing/job-watcher";
import { mintScopeToken } from "../../../../src/shared/publish-consent";
import type { PublishAuditScope } from "../../../../src/shared/publish-audit";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-publish-all-"));
const auditPath = path.join(tmpRoot, "audit.log");

let stdout: ReturnType<typeof vi.spyOn>;

const setupEnv = (): EnvironmentConfiguration => {
  const env = {
    name: "sandbox",
    host: "h",
    tenantId: "tenant-x",
  } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name as string,
    environment: env,
    root: { environments: { [env.name as string]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  return env;
};

/** Build a valid confirm-token for a whole-environment publish scope. */
const fullScopeToken = (languages: string[]): string => {
  const scope: PublishAuditScope = {
    envName: "sandbox",
    resolvedTenantId: "tenant-x",
    target: "Edge",
    kind: "full",
    languages,
  };
  return mintScopeToken(scope);
};

const auditLines = (): unknown[] =>
  fs.existsSync(auditPath)
    ? fs
        .readFileSync(auditPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  process.env.SITECOREAI_AUDIT_LOG = auditPath;
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
  vi.mocked(acquirePublishingToken).mockResolvedValue("test-token");
  vi.mocked(listPublishJobs).mockResolvedValue([]);
  vi.mocked(resolvePublishingLocales).mockResolvedValue([]);
});

afterEach(() => {
  stdout.mockRestore();
  delete process.env.SITECOREAI_AUDIT_LOG;
});

describe("runPublishAll — dry-run (what-if) path", () => {
  it("mints a scope token and never submits a job when --allow-write is absent", async () => {
    setupEnv();

    await runPublishAll({ quiet: true });

    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
    // The minted token is written verbatim to stdout.
    const written = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toMatch(/pub_/);
    expect(auditLines()).toHaveLength(0);
  });

  it("treats --allow-write --what-if as a dry-run", async () => {
    setupEnv();

    await runPublishAll({ quiet: true, allowWrite: true, whatIf: true });

    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("surfaces the most recent whole-env publish as a baseline in the pre-flight", async () => {
    setupEnv();
    vi.mocked(listPublishJobs).mockImplementation(async (_client, query) => {
      // First call: completed jobs. Second call: in-flight jobs.
      if (query?.statuses?.includes("Completed")) {
        return [
          {
            id: "job-old",
            state: "completed",
            canCancel: false,
            completedAt: "2026-05-01T00:00:00Z",
            raw: {
              options: { xmc: { site: { mode: "Republish" } } },
              statistics: { itemsSent: 42 },
              system: { finishTime: "2026-05-01T00:00:00Z" },
            },
          },
        ] as never;
      }
      return [] as never;
    });

    await runPublishAll({ quiet: true });

    expect(vi.mocked(listPublishJobs)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("continues the dry-run when the pre-flight token acquisition fails", async () => {
    setupEnv();
    vi.mocked(acquirePublishingToken).mockRejectedValue(new Error("no creds"));

    await runPublishAll({ quiet: true });

    // Pre-flight failure is non-fatal — token is still minted.
    const written = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toMatch(/pub_/);
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });
});

describe("runPublishAll — confirm-token gate", () => {
  it("throws INPUT_INVALID when --allow-write is set without --confirm-token", async () => {
    setupEnv();

    await expect(runPublishAll({ quiet: true, allowWrite: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when the confirm-token is malformed", async () => {
    setupEnv();

    await expect(
      runPublishAll({ quiet: true, allowWrite: true, confirmToken: "not-a-token", yes: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when the confirm-token scope doesn't match", async () => {
    setupEnv();
    // Token minted for a DIFFERENT language set than the run resolves.
    const staleToken = fullScopeToken(["fr-FR"]);
    vi.mocked(resolvePublishingLocales).mockResolvedValue(["en-US"]);

    await expect(
      runPublishAll({ quiet: true, allowWrite: true, confirmToken: staleToken, yes: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });
});

describe("runPublishAll — env-name confirmation gate", () => {
  it("throws INPUT_INVALID in non-interactive mode without --yes", async () => {
    setupEnv();
    const token = fullScopeToken([]);

    await expect(
      runPublishAll({
        quiet: true,
        allowWrite: true,
        confirmToken: token,
        nonInteractive: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when the typed env name doesn't match", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(promptText).mockResolvedValue("wrong-env");

    await expect(
      runPublishAll({ quiet: true, allowWrite: true, confirmToken: token })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(promptText)).toHaveBeenCalled();
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("proceeds when the operator types the env name correctly", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(promptText).mockResolvedValue("sandbox");
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-1",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishAll({ quiet: true, allowWrite: true, confirmToken: token });

    expect(vi.mocked(submitPublishJob)).toHaveBeenCalledOnce();
  });
});

describe("runPublishAll — apply path", () => {
  it("submits a whole-environment job and records an ok audit entry", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-99",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishAll({ quiet: true, allowWrite: true, confirmToken: token, yes: true });

    expect(vi.mocked(submitPublishJob)).toHaveBeenCalledOnce();
    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.xmc?.site).toEqual({ mode: "Republish" });
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ command: "publish all", outcome: "ok", jobId: "job-99" });
  });

  it("honors --mode Smart in the request body", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-2",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishAll({
      quiet: true,
      allowWrite: true,
      confirmToken: token,
      yes: true,
      mode: "Smart",
    });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.xmc?.site).toEqual({ mode: "Smart" });
  });

  it("passes resolved locales through to the request", async () => {
    setupEnv();
    vi.mocked(resolvePublishingLocales).mockResolvedValue(["en-US", "fr-FR"]);
    const token = fullScopeToken(["en-US", "fr-FR"]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-3",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishAll({ quiet: true, allowWrite: true, confirmToken: token, yes: true });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.xmc?.locales).toEqual(["en-US", "fr-FR"]);
  });

  it("prints the job JSON in --json mode", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-json",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishAll({ json: true, allowWrite: true, confirmToken: token, yes: true });

    const last = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null")) as {
      command: string;
      data: { id: string };
    };
    expect(last.command).toBe("publish.all");
    expect(last.data.id).toBe("job-json");
  });

  it("watches the job to terminal in non-interactive mode and prints a JSON summary", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-watch",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);
    vi.mocked(watchPublishJob).mockResolvedValue({
      id: "job-watch",
      state: "completed",
      canCancel: false,
      raw: {},
    } as never);

    await runPublishAll({
      json: true,
      allowWrite: true,
      confirmToken: token,
      yes: true,
      nonInteractive: true,
    });

    expect(vi.mocked(watchPublishJob)).toHaveBeenCalledOnce();
    expect(vi.mocked(throwOnTerminalFailure)).toHaveBeenCalledOnce();
    const last = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null")) as {
      command: string;
      data: { terminal: boolean; state: string };
    };
    expect(last.command).toBe("publish.all");
    expect(last.data).toMatchObject({ terminal: true, state: "completed" });
  });

  it("prints a human job summary when watching in non-interactive non-json mode", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-watch-h",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);
    vi.mocked(watchPublishJob).mockResolvedValue({
      id: "job-watch-h",
      state: "completed",
      canCancel: false,
      raw: {},
    } as never);

    await runPublishAll({
      quiet: true,
      allowWrite: true,
      confirmToken: token,
      yes: true,
      nonInteractive: true,
    });

    expect(vi.mocked(printJobSummary)).toHaveBeenCalledOnce();
    expect(vi.mocked(throwOnTerminalFailure)).toHaveBeenCalledOnce();
  });

  it("skips the watch when --no-wait is set in non-interactive mode", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-nowait",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishAll({
      quiet: true,
      allowWrite: true,
      confirmToken: token,
      yes: true,
      nonInteractive: true,
      noWait: true,
    });

    expect(vi.mocked(watchPublishJob)).not.toHaveBeenCalled();
  });

  it("records an error audit entry and rethrows when submit fails", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    const err = Object.assign(new Error("api down"), { code: "NETWORK" });
    vi.mocked(submitPublishJob).mockRejectedValue(err);

    await expect(
      runPublishAll({ quiet: true, allowWrite: true, confirmToken: token, yes: true })
    ).rejects.toThrow("api down");

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      command: "publish all",
      outcome: "error",
      errorCode: "NETWORK",
      errorMessage: "api down",
    });
  });

  it("records errorCode UNKNOWN when the thrown value is a plain Error without code", async () => {
    setupEnv();
    const token = fullScopeToken([]);
    vi.mocked(submitPublishJob).mockRejectedValue(new Error("bare failure"));

    await expect(
      runPublishAll({ quiet: true, allowWrite: true, confirmToken: token, yes: true })
    ).rejects.toThrow("bare failure");

    const lines = auditLines();
    expect(lines[0]).toMatchObject({
      command: "publish all",
      outcome: "error",
      errorCode: "UNKNOWN",
      errorMessage: "bare failure",
    });
  });
});

// ---------------------------------------------------------------------------
// Branch coverage — findLastWholeEnvPublish job-shape filters and the
// in-flight whole-env publish warning.
// ---------------------------------------------------------------------------

describe("runPublishAll — pre-flight job-shape filters", () => {
  it("ignores completed jobs whose xmc shape is not whole-env (no xmc, items set, item-scoped)", async () => {
    setupEnv();
    vi.mocked(listPublishJobs).mockImplementation(async (_client, query) => {
      if (query?.statuses?.includes("Completed")) {
        return [
          // No xmc at all → filtered out.
          { id: "j-no-xmc", state: "completed", canCancel: false, raw: { options: {} } },
          // xmc.items set → item-scoped, filtered out.
          {
            id: "j-items",
            state: "completed",
            canCancel: false,
            raw: { options: { xmc: { items: { mode: "Smart" }, site: { mode: "Smart" } } } },
          },
          // xmc with neither site nor type:"Site" → filtered out.
          {
            id: "j-bare",
            state: "completed",
            canCancel: false,
            raw: { options: { xmc: { locales: ["en"] } } },
          },
        ] as never;
      }
      return [] as never;
    });

    await runPublishAll({ quiet: true });

    // None of the completed jobs is whole-env → dry-run still finishes,
    // no job submitted, two listPublishJobs calls (completed + in-flight).
    expect(vi.mocked(listPublishJobs)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("recognises the flattened xmc.type === 'Site' response shape as whole-env", async () => {
    setupEnv();
    vi.mocked(listPublishJobs).mockImplementation(async (_client, query) => {
      if (query?.statuses?.includes("Completed")) {
        return [
          {
            id: "j-flat",
            state: "completed",
            canCancel: false,
            // Flattened response discriminator — `type: "Site"`, no nested
            // `site` object — must still classify as whole-env.
            raw: {
              options: { xmc: { type: "Site", mode: "Republish", locales: ["en"] } },
              statistics: { processedCount: 7 },
              system: { finishTime: "2026-05-02T00:00:00Z" },
            },
          },
        ] as never;
      }
      return [] as never;
    });

    await runPublishAll({ quiet: true });

    expect(vi.mocked(listPublishJobs)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("warns when another whole-env publish is already in flight", async () => {
    setupEnv();
    vi.mocked(listPublishJobs).mockImplementation(async (_client, query) => {
      if (query?.statuses?.includes("Completed")) return [] as never;
      // In-flight query → return a queued whole-env job.
      return [
        {
          id: "j-running",
          state: "Running",
          canCancel: true,
          raw: { options: { xmc: { site: { mode: "Republish" } } } },
        },
      ] as never;
    });

    await runPublishAll({ quiet: true });

    const written = stdout.mock.calls.map((c) => String(c[0])).join("");
    // Dry-run still mints a token even though an in-flight job exists.
    expect(written).toMatch(/pub_/);
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });
});
