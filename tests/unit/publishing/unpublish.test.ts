import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../src/config/types";

vi.mock("../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../src/recipe/api/graphql", () => ({ runAuthoringGraphQL: vi.fn() }));
vi.mock("../../../src/publishing/api/auth", () => ({
  acquirePublishingToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("../../../src/publishing/api/client", () => ({
  submitPublishJob: vi.fn(),
}));
vi.mock("../../../src/shared/prompt", () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
  promptText: vi.fn(),
}));
vi.mock("../../../src/publishing/api/languages", () => ({
  resolvePublishingLocales: vi.fn().mockResolvedValue(["en"]),
}));

import { runPublishUnpublish } from "../../../src/publishing/tasks/unpublish";
import { resolveEnvironment } from "../../../src/policy/environment";
import { runAuthoringGraphQL } from "../../../src/recipe/api/graphql";
import { submitPublishJob } from "../../../src/publishing/api/client";

const mockRun = runAuthoringGraphQL as unknown as ReturnType<typeof vi.fn>;
const mockResolveEnv = resolveEnvironment as unknown as ReturnType<typeof vi.fn>;
const mockSubmit = submitPublishJob as unknown as ReturnType<typeof vi.fn>;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-publish-unp-"));
const auditPath = path.join(tmpRoot, "audit.log");

const setupEnv = (production = false): EnvironmentConfiguration => {
  const env = {
    name: "sandbox",
    host: "h",
    tenantId: "tenant-x",
    production,
  } as EnvironmentConfiguration;
  mockResolveEnv.mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  return env;
};

const readResponse = (neverPublish: string) => ({
  item: {
    itemId: "id-1",
    name: "Home",
    path: "/sitecore/content/Home",
    version: {
      version: 1,
      language: { name: "en" },
      fields: { nodes: [{ name: "__Never publish", value: neverPublish }] },
    },
  },
});

beforeEach(() => {
  mockRun.mockReset();
  mockResolveEnv.mockReset();
  mockSubmit.mockReset();
  process.env.SITECOREAI_AUDIT_LOG = auditPath;
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SITECOREAI_AUDIT_LOG;
});

describe("runPublishUnpublish", () => {
  it("requires at least one of --items or --paths", async () => {
    setupEnv();
    await expect(runPublishUnpublish({})).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("dry-run for --strategy delete mints a scope token without calling deleteItem", async () => {
    setupEnv();
    await runPublishUnpublish({
      itemIds: ["id-1"],
      strategy: "delete",
    });
    // Dry-run never touches the wire: no Authoring read, no
    // deleteItem mutation, no publish-job submit. The operator gets
    // a token they can pass back with --allow-write --confirm-token
    // (and either --confirm-item-path or the interactive prompt).
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(fs.existsSync(auditPath)).toBe(false);
  });

  it("delete in non-interactive mode requires --yes and --confirm-item-path", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    });
    await expect(
      runPublishUnpublish({
        itemIds: ["id-1"],
        strategy: "delete",
        allowWrite: true,
        whatIf: false,
        yes: true,
        nonInteractive: true,
        // --confirm-item-path intentionally absent
      })
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("--confirm-item-path"),
    });
  });

  it("delete refuses when --confirm-item-path doesn't match the resolved path", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    });
    await expect(
      runPublishUnpublish({
        itemIds: ["id-1"],
        strategy: "delete",
        allowWrite: true,
        whatIf: false,
        yes: true,
        nonInteractive: true,
        confirmItemPath: "/sitecore/content/WRONG-PATH",
      })
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("mismatch"),
    });
  });

  it("dry-run does not write fields or submit a publish job", async () => {
    setupEnv();
    await runPublishUnpublish({
      itemIds: ["id-1"],
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(fs.existsSync(auditPath)).toBe(false);
  });

  it("never-publish strategy: writes __Never publish:1, submits publish job, writes audit", async () => {
    setupEnv();
    // Read snapshot.
    mockRun.mockResolvedValueOnce(readResponse(""));
    // Write update.
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });
    mockSubmit.mockResolvedValue({ id: "job-9", state: "queued", canCancel: true, raw: {} });

    await runPublishUnpublish({
      itemIds: ["id-1"],
      languages: ["en"],
      allowWrite: true,
      yes: true,
    });

    // Read + write GraphQL calls.
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockSubmit).toHaveBeenCalledOnce();
    const submitArgs = mockSubmit.mock.calls[0][1];
    expect(submitArgs.options.items).toEqual([{ id: "id-1", type: "item" }]);
    expect(submitArgs.options.xmc.items.mode).toBe("Smart");

    // Two audit entries: one for the per-item write, one for the job
    // submission.
    const lines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const writeEntry = JSON.parse(lines[0]);
    expect(writeEntry.command).toBe("publish unpublish");
    expect(writeEntry.fieldChanges).toEqual([{ name: "__Never publish", before: "", after: "1" }]);
    const submitEntry = JSON.parse(lines[1]);
    expect(submitEntry.jobId).toBe("job-9");
    expect(submitEntry.outcome).toBe("ok");
    expect(submitEntry.scope.kind).toBe("unpublish");
    expect(submitEntry.scope.strategy).toBe("never-publish");
  });

  it("expire-now strategy writes __Valid to with an ISO timestamp", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse("")); // unrelated never-publish; not the field we look at
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });
    mockSubmit.mockResolvedValue({ id: "job-1", state: "queued", canCancel: true, raw: {} });

    await runPublishUnpublish({
      itemIds: ["id-1"],
      languages: ["en"],
      strategy: "expire-now",
      allowWrite: true,
      yes: true,
    });
    const writeVars = mockRun.mock.calls[1][2] as {
      fields: Array<{ name: string; value: string }>;
    };
    expect(writeVars.fields[0].name).toBe("__Valid to");
    // ISO 8601 with a Z suffix.
    expect(writeVars.fields[0].value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("production-tier without --confirm-token errors before any write", async () => {
    setupEnv(true);
    await expect(
      runPublishUnpublish({
        itemIds: ["id-1"],
        allowWrite: true,
      })
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("--confirm-token"),
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("resolves paths to itemIds via the publishing path resolver", async () => {
    setupEnv();
    // Path resolver issues a batched GraphQL query — return the
    // aliased response. Then read + write snapshots.
    mockRun.mockResolvedValueOnce({
      i0: { itemId: "id-1", path: "/sitecore/content/Home" },
    });
    mockRun.mockResolvedValueOnce(readResponse(""));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });
    mockSubmit.mockResolvedValue({ id: "job-1", state: "queued", canCancel: true, raw: {} });

    await runPublishUnpublish({
      paths: ["/sitecore/content/Home"],
      languages: ["en"],
      allowWrite: true,
      yes: true,
    });
    expect(mockSubmit).toHaveBeenCalledOnce();
    const submitArgs = mockSubmit.mock.calls[0][1];
    expect(submitArgs.options.items).toEqual([{ id: "id-1", type: "item" }]);
  });

  it("captures per-write audit entry when field write fails (publish job not attempted)", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse(""));
    mockRun.mockRejectedValueOnce(new Error("auth denied"));

    await expect(
      runPublishUnpublish({
        itemIds: ["id-1"],
        languages: ["en"],
        allowWrite: true,
        yes: true,
      })
    ).rejects.toThrow("auth denied");

    // submitPublishJob should never have been called.
    expect(mockSubmit).not.toHaveBeenCalled();
    const entry = JSON.parse(fs.readFileSync(auditPath, "utf8").trim());
    expect(entry.outcome).toBe("error");
    expect(entry.errorMessage).toBe("auth denied");
  });

  it("audits an error entry when the publish-job submission fails", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse(""));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });
    mockSubmit.mockRejectedValue(new Error("network blew up"));

    await expect(
      runPublishUnpublish({
        itemIds: ["id-1"],
        languages: ["en"],
        allowWrite: true,
        yes: true,
      })
    ).rejects.toThrow("network blew up");

    const lines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
    // 1 ok (field write) + 1 error (job submit).
    expect(lines).toHaveLength(2);
    const errEntry = JSON.parse(lines[1]);
    expect(errEntry.outcome).toBe("error");
    expect(errEntry.errorMessage).toBe("network blew up");
  });
});
