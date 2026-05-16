import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient, SearchPage } from "../../../../src/hygiene/api/client";
import { runCleanupWorkflowApply } from "../../../../src/hygiene/tasks/cleanup/workflow-apply";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
vi.mock("../../../../src/workflow/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/workflow/api/client")>();
  return { ...actual, createWorkflowApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import {
  createWorkflowApiClient,
  type WorkflowApiClient,
} from "../../../../src/workflow/api/client";

const ENV_NAME = "sandbox";

const setup = (allowWrite = true) => {
  const env = { name: ENV_NAME, host: "h", allowWrite } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
};

const WORKFLOW_DETAIL = {
  itemId: "{ABCDABCD-ABCD-ABCD-ABCD-ABCDABCDABCD}",
  name: "Article Workflow",
  displayName: "Article Workflow",
  path: "/sitecore/system/Workflows/Article Workflow",
  states: [
    {
      itemId: "{11111111-1111-1111-1111-111111111111}",
      name: "Draft",
      displayName: "Draft",
      final: false,
      preview: false,
    },
    {
      itemId: "{22222222-2222-2222-2222-222222222222}",
      name: "Approved",
      displayName: "Approved",
      final: true,
      preview: false,
    },
  ],
} as never;

const stubWorkflowClient = (overrides: Partial<WorkflowApiClient> = {}): WorkflowApiClient => {
  const base = {
    getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(WORKFLOW_DETAIL),
    getWorkflowInitialStateId: vi.fn().mockResolvedValue(WORKFLOW_DETAIL.states[0]!.itemId),
    findWorkflowDefinitionByName: vi.fn().mockResolvedValue({
      summary: {
        itemId: WORKFLOW_DETAIL.itemId,
        name: WORKFLOW_DETAIL.name,
        path: WORKFLOW_DETAIL.path,
      },
      duplicateMatches: 0,
    }),
    getItemWorkflow: vi.fn().mockResolvedValue(null),
    setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    listWorkflowDefinitions: vi.fn(),
    getWorkflowCommandsForItem: vi.fn(),
    executeWorkflowCommand: vi.fn(),
    searchItemsByWorkflowState: vi.fn(),
  };
  const client = { ...base, ...overrides } as WorkflowApiClient;
  vi.mocked(createWorkflowApiClient).mockReturnValue(client);
  return client;
};

const stubHygieneClient = (overrides: Partial<HygieneApiClient> = {}): HygieneApiClient => {
  const base = {
    // Default: root path resolves and one candidate item appears under it.
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
    } as SearchPage),
    searchAll: vi.fn().mockImplementation(async function* () {
      yield {
        itemId: "{deadbeef-0000-0000-0000-000000000001}",
        path: "/sitecore/content/MySite/Page1",
        name: "Page1",
        templateId: "{deadbeef-1111-1111-1111-111111111111}",
        language: { name: "en" },
        version: 1,
        updatedDate: new Date().toISOString(),
      };
    }),
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
    renameItem: vi.fn(),
    addItemVersion: vi.fn(),
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

describe("cleanup workflow-apply — safety rails", () => {
  it("rejects missing --workflow with INPUT_INVALID", async () => {
    setup();
    stubHygieneClient();
    stubWorkflowClient();
    await expect(
      runCleanupWorkflowApply({ root: "/sitecore/content/MySite", json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("requires allowWrite outside --what-if", async () => {
    setup(false);
    stubHygieneClient();
    stubWorkflowClient();
    await expect(
      runCleanupWorkflowApply({
        workflow: "Article Workflow",
        root: "/sitecore/content/MySite",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("--what-if bypasses allowWrite enforcement", async () => {
    setup(false);
    stubHygieneClient({
      searchAll: vi.fn().mockImplementation(async function* () {}),
    });
    stubWorkflowClient();
    await expect(
      runCleanupWorkflowApply({
        workflow: "Article Workflow",
        root: "/sitecore/content/MySite",
        whatIf: true,
        json: true,
      } as never)
    ).resolves.toBeDefined();
  });

  it("rejects an unresolvable workflow ref", async () => {
    setup();
    stubHygieneClient();
    stubWorkflowClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(null),
      findWorkflowDefinitionByName: vi.fn().mockResolvedValue(null),
    });
    await expect(
      runCleanupWorkflowApply({
        workflow: "made-up-name",
        root: "/sitecore/content/MySite",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects an unresolvable template ref", async () => {
    setup();
    // Template lookup runs before the root lookup. Return 0 results on
    // the first search call so the task throws INPUT_INVALID on the
    // template ref instead of carrying on with a null templateId.
    stubHygieneClient({
      search: vi.fn().mockResolvedValue({ totalCount: 0, results: [] }),
    });
    stubWorkflowClient();
    await expect(
      runCleanupWorkflowApply({
        workflow: "Article Workflow",
        template: "/sitecore/templates/Foundation/NonExistent",
        root: "/sitecore/content/MySite",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup workflow-apply — apply logic", () => {
  it("attaches an unassigned item via setItemWorkflowState", async () => {
    setup();
    stubHygieneClient();
    const wfClient = stubWorkflowClient();

    const result = await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("applied");
    expect(wfClient.setItemWorkflowState).toHaveBeenCalledTimes(1);
    expect(wfClient.setItemWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: WORKFLOW_DETAIL.itemId,
        stateId: WORKFLOW_DETAIL.states[0]!.itemId,
      })
    );
  });

  it("skips items already attached to the same workflow + state (idempotent)", async () => {
    setup();
    stubHygieneClient();
    const wfClient = stubWorkflowClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "{deadbeef-0000-0000-0000-000000000001}",
        path: "/sitecore/content/MySite/Page1",
        workflowId: WORKFLOW_DETAIL.itemId,
        workflowName: "Article Workflow",
        stateId: WORKFLOW_DETAIL.states[0]!.itemId,
        stateName: "Draft",
        stateIsFinal: false,
      }),
    });

    const result = await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result[0]!.status).toBe("skipped-already-attached");
    expect(wfClient.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("skips items attached to a DIFFERENT workflow when --reattach is off", async () => {
    setup();
    stubHygieneClient();
    const wfClient = stubWorkflowClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "{deadbeef-0000-0000-0000-000000000001}",
        path: "/sitecore/content/MySite/Page1",
        workflowId: "{99999999-9999-9999-9999-999999999999}",
        workflowName: "Other Workflow",
        stateId: "{88888888-8888-8888-8888-888888888888}",
        stateName: "InReview",
        stateIsFinal: false,
      }),
    });

    const result = await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result[0]!.status).toBe("skipped-already-attached");
    expect(wfClient.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("overwrites the assignment when --reattach is on", async () => {
    setup();
    stubHygieneClient();
    const wfClient = stubWorkflowClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "{deadbeef-0000-0000-0000-000000000001}",
        path: "/sitecore/content/MySite/Page1",
        workflowId: "{99999999-9999-9999-9999-999999999999}",
        workflowName: "Other Workflow",
        stateId: "{88888888-8888-8888-8888-888888888888}",
        stateName: "InReview",
        stateIsFinal: false,
      }),
    });

    const result = await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      root: "/sitecore/content/MySite",
      reattach: true,
      json: true,
    } as never);

    expect(result[0]!.status).toBe("applied");
    expect(wfClient.setItemWorkflowState).toHaveBeenCalledTimes(1);
  });

  it("--what-if reports the plan without calling setItemWorkflowState", async () => {
    setup(false);
    stubHygieneClient();
    const wfClient = stubWorkflowClient();

    const result = await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      root: "/sitecore/content/MySite",
      whatIf: true,
      json: true,
    } as never);

    expect(result[0]!.status).toBe("what-if");
    expect(wfClient.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("respects --max-applies", async () => {
    setup();
    stubHygieneClient({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      } as SearchPage),
      searchAll: vi.fn().mockImplementation(async function* () {
        for (let i = 0; i < 3; i++) {
          yield {
            itemId: `{deadbeef-0000-0000-0000-00000000000${i}}`,
            path: `/sitecore/content/MySite/Page${i}`,
            name: `Page${i}`,
            templateId: null,
            language: { name: "en" },
            version: 1,
            updatedDate: new Date().toISOString(),
          };
        }
      }),
    });
    const wfClient = stubWorkflowClient();

    const result = await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      maxApplies: 1,
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result.filter((a) => a.status === "applied")).toHaveLength(1);
    expect(wfClient.setItemWorkflowState).toHaveBeenCalledTimes(1);
  });

  it("falls back to the workflow's initial state when --state is omitted", async () => {
    setup();
    stubHygieneClient();
    const wfClient = stubWorkflowClient();

    await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(wfClient.getWorkflowInitialStateId).toHaveBeenCalledWith(WORKFLOW_DETAIL.itemId);
    expect(wfClient.setItemWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: WORKFLOW_DETAIL.states[0]!.itemId })
    );
  });

  it("honors an explicit --state override by name", async () => {
    setup();
    stubHygieneClient();
    const wfClient = stubWorkflowClient();

    await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      state: "Approved",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(wfClient.setItemWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: WORKFLOW_DETAIL.states[1]!.itemId })
    );
  });

  it("captures setItemWorkflowState failures without aborting the run", async () => {
    setup();
    stubHygieneClient();
    stubWorkflowClient({
      setItemWorkflowState: vi.fn().mockRejectedValue(new Error("network blip")),
    });

    const result = await runCleanupWorkflowApply({
      workflow: "Article Workflow",
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result[0]!.status).toBe("failed");
    expect(result[0]!.error).toContain("network blip");
  });
});
