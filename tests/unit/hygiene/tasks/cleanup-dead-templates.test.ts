import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupDeadTemplates } from "../../../../src/hygiene/tasks/cleanup-dead-templates";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
// The cleanup re-runs the audit to discover candidates; mock the audit so
// these tests stay focused on the cleanup logic.
vi.mock("../../../../src/hygiene/tasks/audit-dead-templates", () => ({
  runAuditDeadTemplates: vi.fn(),
}));

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditDeadTemplates } from "../../../../src/hygiene/tasks/audit-dead-templates";

const setup = (allowWrite = true): EnvironmentConfiguration => {
  const env = { name: "sandbox", host: "h", allowWrite } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  return env;
};

const stub = (overrides: Partial<HygieneApiClient>): HygieneApiClient => {
  const base = {
    search: vi.fn(),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    deleteItemTemplate: vi.fn().mockResolvedValue(undefined),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn().mockResolvedValue([]),
    updateItemFields: vi.fn(),
    listUsers: vi.fn(),
    listRoles: vi.fn(),
    getUserDetail: vi.fn(),
    deleteUser: vi.fn(),
    deleteRole: vi.fn(),
    executeWorkflowCommand: vi.fn(),
    getWorkflowCommandsForItem: vi.fn(),
  };
  const client = { ...base, ...overrides } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("cleanup dead-templates — safety rails", () => {
  it("refuses /sitecore/templates/System without --force", async () => {
    setup();
    stub({});
    await expect(
      runCleanupDeadTemplates({
        root: "/sitecore/templates/System",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("allows protected roots when --force is set", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([]);
    stub({});
    await expect(
      runCleanupDeadTemplates({
        root: "/sitecore/templates/System",
        force: true,
        json: true,
      } as never)
    ).resolves.toBeDefined();
  });

  it("requires allowWrite outside --what-if", async () => {
    setup(false);
    stub({});
    await expect(runCleanupDeadTemplates({ json: true } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("--what-if bypasses allowWrite enforcement", async () => {
    setup(false);
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([]);
    stub({});
    await expect(
      runCleanupDeadTemplates({ whatIf: true, json: true } as never)
    ).resolves.toBeDefined();
  });
});

describe("cleanup dead-templates — purge logic", () => {
  it("deletes every template the audit returns", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: "/sitecore/templates/Project/T1" },
      { templateId: "t2", name: "T2", fullName: "/sitecore/templates/Project/T2" },
    ] as never);
    const client = stub({});

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.templates).toHaveLength(2);
    expect(result.templates.every((t) => t.status === "purged")).toBe(true);
    expect(client.deleteItemTemplate).toHaveBeenCalledTimes(2);
  });

  it("--what-if reports the plan without calling deleteItemTemplate", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: "/sitecore/templates/Project/T1" },
    ] as never);
    const client = stub({});

    const result = await runCleanupDeadTemplates({ whatIf: true, json: true } as never);

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].status).toBe("what-if");
    expect(client.deleteItemTemplate).not.toHaveBeenCalled();
  });

  it("captures per-template failures without aborting the run", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
      { templateId: "t2", name: "T2", fullName: null },
    ] as never);
    const client = stub({
      deleteItemTemplate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("still used as base template")),
    });

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.templates).toHaveLength(2);
    expect(result.templates[0].status).toBe("purged");
    expect(result.templates[1].status).toBe("failed");
    expect(result.templates[1].error).toContain("still used");
    expect(client.deleteItemTemplate).toHaveBeenCalledTimes(2);
  });

  it("skips empty-folder cleanup when cleanupEmptyFolders=false", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    const client = stub({
      getChildren: vi.fn(),
    });

    const result = await runCleanupDeadTemplates({
      json: true,
      cleanupEmptyFolders: false,
    } as never);

    expect(result.folders).toEqual([]);
    expect(client.getChildren).not.toHaveBeenCalled();
  });

  it("skips empty-folder cleanup entirely when no templates were purged", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([]);
    const client = stub({});

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.templates).toEqual([]);
    expect(result.folders).toEqual([]);
    expect(client.getChildren).not.toHaveBeenCalled();
  });
});
