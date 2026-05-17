import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient, SearchPage } from "../../../../src/hygiene/api/client";
import { runCleanupWorkflowAdvance } from "../../../../src/hygiene/tasks/cleanup/workflow-advance";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
vi.mock("../../../../src/workflow/api/resolve-command", () => ({
  resolveWorkflowCommandId: vi.fn(),
}));

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { resolveWorkflowCommandId } from "../../../../src/workflow/api/resolve-command";

const setup = (allowWrite = true) => {
  const env = { name: "sandbox", host: "h", allowWrite } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
};

const stub = (overrides: Partial<HygieneApiClient>): HygieneApiClient => {
  const base = {
    search: vi.fn().mockResolvedValue({ totalCount: 0, results: [] } as SearchPage),
    searchAll: vi.fn().mockImplementation(async function* () {}),
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
    deleteUser: vi.fn(),
    deleteRole: vi.fn(),
    executeWorkflowCommand: vi
      .fn()
      .mockResolvedValue({ successful: true, nextStateId: "approved" }),
    getWorkflowCommandsForItem: vi.fn(),
  };
  const client = { ...base, ...overrides } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

const yieldStaleItem = async function* () {
  yield {
    itemId: "item-1",
    path: "/sitecore/content/MySite/Page",
    name: "Page",
    language: { name: "en" },
    version: 1,
    updatedDate: oldDate,
  };
};

describe("cleanup workflow-advance — safety rails", () => {
  it("rejects missing --command-name with INPUT_INVALID", async () => {
    setup();
    stub({});
    await expect(
      runCleanupWorkflowAdvance({ root: "/sitecore/content/MySite", json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("requires allowWrite outside --what-if", async () => {
    setup(false);
    stub({});
    await expect(
      runCleanupWorkflowAdvance({
        commandName: "Submit",
        root: "/sitecore/content/MySite",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("--what-if bypasses allowWrite enforcement", async () => {
    setup(false);
    stub({});
    await expect(
      runCleanupWorkflowAdvance({
        commandName: "Submit",
        whatIf: true,
        json: true,
      } as never)
    ).resolves.toBeDefined();
  });
});

describe("cleanup workflow-advance — advance logic", () => {
  it("advances stale items via executeWorkflowCommand", async () => {
    setup();
    const client = stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(yieldStaleItem),
      getItemWorkflow: vi.fn().mockResolvedValue({
        workflowId: "wf-1",
        workflowName: "Editorial",
        stateName: "Draft",
        stateIsFinal: false,
      }),
    });
    vi.mocked(resolveWorkflowCommandId).mockResolvedValue({
      commandId: "cmd-1",
      displayName: "Submit",
    } as never);

    const result = await runCleanupWorkflowAdvance({
      commandName: "Submit",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("advanced");
    expect(result[0].toState).toBe("approved");
    expect(client.executeWorkflowCommand).toHaveBeenCalledTimes(1);
  });

  it("skips items whose workflow has no matching command", async () => {
    setup();
    const client = stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(yieldStaleItem),
      getItemWorkflow: vi.fn().mockResolvedValue({
        workflowId: "wf-1",
        workflowName: "Editorial",
        stateName: "Draft",
        stateIsFinal: false,
      }),
    });
    vi.mocked(resolveWorkflowCommandId).mockResolvedValue(null);

    const result = await runCleanupWorkflowAdvance({
      commandName: "Approve",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("skipped-no-command");
    expect(client.executeWorkflowCommand).not.toHaveBeenCalled();
  });

  it("--what-if reports the plan without calling executeWorkflowCommand", async () => {
    setup(false);
    const client = stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(yieldStaleItem),
      getItemWorkflow: vi.fn().mockResolvedValue({
        workflowId: "wf-1",
        workflowName: "Editorial",
        stateName: "Draft",
        stateIsFinal: false,
      }),
    });
    vi.mocked(resolveWorkflowCommandId).mockResolvedValue({
      commandId: "cmd-1",
      displayName: "Submit",
    } as never);

    const result = await runCleanupWorkflowAdvance({
      commandName: "Submit",
      root: "/sitecore/content/MySite",
      whatIf: true,
      json: true,
    } as never);

    expect(result[0].status).toBe("what-if");
    expect(client.executeWorkflowCommand).not.toHaveBeenCalled();
  });

  it("respects --max-advances", async () => {
    setup();
    const client = stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(async function* () {
        for (let i = 0; i < 3; i++) {
          yield {
            itemId: `item-${i}`,
            path: `/sitecore/content/MySite/Page${i}`,
            name: `Page${i}`,
            language: { name: "en" },
            version: 1,
            updatedDate: oldDate,
          };
        }
      }),
      getItemWorkflow: vi.fn().mockResolvedValue({
        workflowId: "wf-1",
        workflowName: "Editorial",
        stateName: "Draft",
        stateIsFinal: false,
      }),
    });
    vi.mocked(resolveWorkflowCommandId).mockResolvedValue({
      commandId: "cmd-1",
      displayName: "Submit",
    } as never);

    const result = await runCleanupWorkflowAdvance({
      commandName: "Submit",
      maxAdvances: 1,
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    // maxAdvances caps the number of items processed (some are filtered
    // by idx >= maxAdvances and return null).
    expect(result.filter((a) => a.status === "advanced")).toHaveLength(1);
    expect(client.executeWorkflowCommand).toHaveBeenCalledTimes(1);
  });

  it("excludes items whose workflow state is final", async () => {
    setup();
    const client = stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(yieldStaleItem),
      getItemWorkflow: vi.fn().mockResolvedValue({
        workflowId: "wf-1",
        workflowName: "Editorial",
        stateName: "Approved",
        stateIsFinal: true,
      }),
    });

    const result = await runCleanupWorkflowAdvance({
      commandName: "Submit",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result).toHaveLength(0);
    expect(client.executeWorkflowCommand).not.toHaveBeenCalled();
  });

  it("captures execution failures without aborting the run", async () => {
    setup();
    stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(yieldStaleItem),
      getItemWorkflow: vi.fn().mockResolvedValue({
        workflowId: "wf-1",
        workflowName: "Editorial",
        stateName: "Draft",
        stateIsFinal: false,
      }),
      executeWorkflowCommand: vi
        .fn()
        .mockResolvedValue({ successful: false, message: "validation failed" }),
    });
    vi.mocked(resolveWorkflowCommandId).mockResolvedValue({
      commandId: "cmd-1",
      displayName: "Submit",
    } as never);

    const result = await runCleanupWorkflowAdvance({
      commandName: "Submit",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result[0].status).toBe("failed");
    expect(result[0].error).toContain("validation failed");
  });
});
