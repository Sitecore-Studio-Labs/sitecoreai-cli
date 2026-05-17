import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupEmptyFolders } from "../../../../src/hygiene/tasks/cleanup/empty-folders";
import { runCleanupRoles } from "../../../../src/hygiene/tasks/cleanup/roles";
import { runCleanupUsers } from "../../../../src/hygiene/tasks/cleanup/users";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

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
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
    updateItemFields: vi.fn(),
    listUsers: vi.fn(),
    listRoles: vi.fn(),
    getUserDetail: vi.fn(),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    deleteRole: vi.fn().mockResolvedValue(undefined),
    executeWorkflowCommand: vi.fn(),
    getWorkflowCommandsForItem: vi.fn(),
  };
  const client = { ...base, ...overrides } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("cleanup empty-folders", () => {
  it("rejects missing --root", async () => {
    setup();
    stub({});
    await expect(runCleanupEmptyFolders({ json: true } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("refuses protected roots without --force", async () => {
    setup();
    stub({});
    await expect(
      runCleanupEmptyFolders({
        root: "/sitecore/templates",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("requires allowWrite outside --what-if", async () => {
    setup(false);
    stub({ getChildren: vi.fn().mockResolvedValue([]) });
    await expect(
      runCleanupEmptyFolders({ root: "/sitecore/content/MySite", json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("--what-if reports empty descendants without deleting", async () => {
    setup(false);
    // Use the well-known Common/Folder template id so the descendant
    // passes the folder-template gate added after the 2026-05-14
    // incident — pre-gate, any zero-child leaf qualified, which would
    // sweep Pages and other live content.
    const client = stub({
      getChildren: vi.fn().mockImplementation((sel) => {
        if (sel.path === "/sitecore/content/MySite") {
          return Promise.resolve([
            {
              itemId: "child1",
              name: "Empty",
              path: "/sitecore/content/MySite/Empty",
              templateId: "a87a00b1-e6db-45ab-8b54-636fec3b5523",
              templateName: "Folder",
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    });
    const result = await runCleanupEmptyFolders({
      root: "/sitecore/content/MySite",
      whatIf: true,
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("what-if");
    expect(client.deleteItem).not.toHaveBeenCalled();
  });
});

describe("cleanup roles", () => {
  it("deletes empty roles found by the audit", async () => {
    setup();
    const client = stub({
      listRoles: vi.fn().mockResolvedValue([
        { name: "sitecore\\Empty1", domain: "sitecore", memberCount: 0 },
        { name: "sitecore\\Full", domain: "sitecore", memberCount: 5 },
      ]),
    });
    const result = await runCleanupRoles({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("deleted");
    expect(client.deleteRole).toHaveBeenCalledWith("sitecore\\Empty1");
  });

  it("respects --max-deletions", async () => {
    setup();
    const client = stub({
      listRoles: vi.fn().mockResolvedValue([
        { name: "a", domain: "x", memberCount: 0 },
        { name: "b", domain: "x", memberCount: 0 },
        { name: "c", domain: "x", memberCount: 0 },
      ]),
    });
    await runCleanupRoles({ maxDeletions: 1, json: true } as never);
    expect(client.deleteRole).toHaveBeenCalledTimes(1);
  });
});

describe("cleanup users", () => {
  it("deletes stale users found by the audit (default 365-day threshold)", async () => {
    setup();
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const client = stub({
      listUsers: vi
        .fn()
        .mockResolvedValue([
          { name: "u1", isAdministrator: false, isAuthenticated: true, domain: "sitecore" },
        ]),
      getUserDetail: vi.fn().mockResolvedValue({
        name: "u1",
        isAdministrator: false,
        roles: [],
        lastLogin: old,
        lastActivity: old,
      }),
    });
    const result = await runCleanupUsers({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(client.deleteUser).toHaveBeenCalledWith("u1");
  });
});
