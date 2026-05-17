import { consola } from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkflowApply } from "../../../../src/workflow/tasks/apply";
import * as sharedModule from "../../../../src/workflow/tasks/shared";
import * as allowWriteModule from "../../../../src/policy/allow-write";
import type {
  WorkflowApiClient,
  WorkflowDefinitionDetail,
} from "../../../../src/workflow/api/client";

vi.mock("../../../../src/workflow/tasks/shared", async () => {
  const actual = await vi.importActual<typeof sharedModule>(
    "../../../../src/workflow/tasks/shared"
  );
  return { ...actual, resolveWorkflowTenant: vi.fn() };
});

vi.mock("../../../../src/policy/allow-write", async () => {
  const actual = await vi.importActual<typeof allowWriteModule>(
    "../../../../src/policy/allow-write"
  );
  return { ...actual, ensureAllowWrite: vi.fn() };
});

const stubClient = (overrides: Partial<WorkflowApiClient> = {}): WorkflowApiClient => ({
  getItemWorkflow: vi.fn().mockResolvedValue(null),
  getWorkflowCommandsForItem: vi.fn().mockResolvedValue([]),
  executeWorkflowCommand: vi.fn(),
  listWorkflowDefinitions: vi.fn().mockResolvedValue([]),
  searchItemsByWorkflowState: vi.fn().mockResolvedValue([]),
  getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(null),
  findWorkflowDefinitionByName: vi.fn().mockResolvedValue(null),
  setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
  getWorkflowInitialStateId: vi.fn().mockResolvedValue(null),
  ...overrides,
});

const installClient = (client: WorkflowApiClient): void => {
  vi.mocked(sharedModule.resolveWorkflowTenant).mockReturnValue({
    envName: "test",
    environment: {} as never,
    root: { environments: {} } as never,
    client,
  });
};

/**
 * A workflow definition with NO displayName — exercises the
 * `displayName ?? name` fallback arms throughout `runWorkflowApply`.
 */
const definitionNoDisplayName = (): WorkflowDefinitionDetail => ({
  itemId: "{abcdef01-2345-6789-abcd-ef0123456789}",
  name: "Editorial",
  displayName: undefined,
  path: "/sitecore/system/Workflows/Editorial",
  states: [
    {
      itemId: "{11111111-1111-1111-1111-111111111111}",
      name: "Draft",
      displayName: undefined,
      path: "/sitecore/system/Workflows/Editorial/Draft",
      templateName: "State",
      commands: [],
      actions: [],
    },
  ],
});

/** A workflow definition with a Draft state. */
const definition = (): WorkflowDefinitionDetail => ({
  itemId: "{abcdef01-2345-6789-abcd-ef0123456789}",
  name: "Editorial",
  displayName: "Editorial Workflow",
  path: "/sitecore/system/Workflows/Editorial",
  states: [
    {
      itemId: "{11111111-1111-1111-1111-111111111111}",
      name: "Draft",
      displayName: "Draft",
      path: "/sitecore/system/Workflows/Editorial/Draft",
      templateName: "State",
      commands: [],
      actions: [],
    },
    {
      itemId: "{22222222-2222-2222-2222-222222222222}",
      name: "Approved",
      displayName: "Approved",
      path: "/sitecore/system/Workflows/Editorial/Approved",
      templateName: "State",
      commands: [],
      actions: [],
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWorkflowApply", () => {
  it("throws INPUT_INVALID when --workflow is missing", async () => {
    installClient(stubClient());
    await expect(
      runWorkflowApply({ item: "/sitecore/content/x", workflow: "", json: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when the item reference is not a GUID or path", async () => {
    installClient(stubClient());
    await expect(
      runWorkflowApply({ item: "not-a-ref", workflow: "Editorial", json: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("returns skipped-workflow-not-found when the workflow ref does not resolve", async () => {
    const client = stubClient({
      findWorkflowDefinitionByName: vi.fn().mockResolvedValue(null),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Ghost Workflow",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-workflow-not-found");
    expect(client.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("returns skipped-state-not-found when --state names an unknown state", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Nonexistent",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-state-not-found");
    expect(client.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("throws UNKNOWN when no --state given and the workflow has no __Initial state", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue(null),
    });
    installClient(client);

    await expect(
      runWorkflowApply({
        item: "/sitecore/content/x",
        workflow: "Editorial",
        allowWrite: true,
        json: true,
      })
    ).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("skips the allowWrite gate in --what-if mode and reports what-if", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      whatIf: true,
      json: true,
    });

    expect(result.status).toBe("what-if");
    expect(result.stateName).toBe("Draft");
    expect(allowWriteModule.ensureAllowWrite).not.toHaveBeenCalled();
    expect(client.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("calls ensureAllowWrite when not in --what-if mode", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
    });
    installClient(client);

    await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      allowWrite: true,
      json: true,
    });

    expect(allowWriteModule.ensureAllowWrite).toHaveBeenCalledWith(
      expect.objectContaining({ environments: expect.anything() }),
      "test",
      true
    );
  });

  it("returns skipped-already-attached when item is already on the workflow + state", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "x",
        path: "/sitecore/content/x",
        workflowId: "{abcdef01-2345-6789-abcd-ef0123456789}",
        workflowName: "Editorial Workflow",
        stateId: "{11111111-1111-1111-1111-111111111111}",
        stateName: "Draft",
        stateIsFinal: false,
      }),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Draft",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-already-attached");
    expect(client.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("applies the workflow + explicit state and returns applied on success", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue(null),
      setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Approved",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("applied");
    expect(result.stateName).toBe("Approved");
    expect(result.workflowName).toBe("Editorial Workflow");
    expect(client.setItemWorkflowState).toHaveBeenCalledWith({
      path: "/sitecore/content/x",
      workflowId: detail.itemId,
      stateId: "{22222222-2222-2222-2222-222222222222}",
    });
  });

  it("returns failed when setItemWorkflowState throws", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue(null),
      setItemWorkflowState: vi.fn().mockRejectedValue(new Error("write blew up")),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Draft",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toBe("write blew up");
  });

  it("resolves the workflow by GUID ref and applies the initial state", async () => {
    const detail = definition();
    const getDetail = vi.fn().mockResolvedValue(detail);
    const client = stubClient({
      getWorkflowDefinitionDetail: getDetail,
      getItemWorkflow: vi.fn().mockResolvedValue(null),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("22222222-2222-2222-2222-222222222222"),
      setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}",
      workflow: "{abcdef01-2345-6789-abcd-ef0123456789}",
      allowWrite: true,
      json: true,
    });

    // GUID ref → getWorkflowDefinitionDetail({ itemId }) directly.
    expect(getDetail).toHaveBeenCalledWith({
      itemId: "{abcdef01-2345-6789-abcd-ef0123456789}",
    });
    // The default-state path resolves to the initial state (Approved).
    expect(result.status).toBe("applied");
    expect(result.stateName).toBe("Approved");
  });

  it("passes itemId (not path) to setItemWorkflowState when the ref is a GUID", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue(null),
      setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    });
    installClient(client);

    await runWorkflowApply({
      item: "{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}",
      workflow: "Editorial",
      state: "Draft",
      allowWrite: true,
      json: true,
    });

    expect(client.setItemWorkflowState).toHaveBeenCalledWith({
      itemId: "{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}",
      workflowId: detail.itemId,
      stateId: "{11111111-1111-1111-1111-111111111111}",
    });
  });

  it("resolves a state by GUID ref", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue(null),
      setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "{22222222-2222-2222-2222-222222222222}",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("applied");
    expect(result.stateName).toBe("Approved");
  });

  it("carries the existing item identity onto an applied result when already workflowed elsewhere", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      // Item is on a DIFFERENT workflow → not idempotent-skip, but the
      // existing identity (itemId/path) still flows onto the result.
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "resolved-x",
        path: "/sitecore/content/x",
        workflowId: "{ffffffff-ffff-ffff-ffff-ffffffffffff}",
        workflowName: "Other",
        stateId: "{99999999-9999-9999-9999-999999999999}",
        stateName: "Old",
        stateIsFinal: false,
      }),
      setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Draft",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("applied");
    expect(result.itemId).toBe("resolved-x");
    expect(result.path).toBe("/sitecore/content/x");
  });
});

describe("runWorkflowApply — text mode (humanLines rendering)", () => {
  const captureInfo = () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(consola, "info")
      .mockImplementation((...a: unknown[]) => lines.push(a.map(String).join(" ")) as never);
    return { lines, restore: () => spy.mockRestore() };
  };

  it("prints the what-if banner and the human-readable result line", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
    });
    installClient(client);

    const cap = captureInfo();
    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      whatIf: true,
    });
    cap.restore();

    expect(result.status).toBe("what-if");
    const text = cap.lines.join("\n");
    expect(text).toContain("What-if mode — no field write will happen.");
    expect(text).toContain("Would attach /sitecore/content/x");
  });

  it("prints the human result line for a workflow-not-found skip", async () => {
    const client = stubClient({ findWorkflowDefinitionByName: vi.fn().mockResolvedValue(null) });
    installClient(client);

    const cap = captureInfo();
    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Ghost",
      allowWrite: true,
    });
    cap.restore();

    expect(result.status).toBe("skipped-workflow-not-found");
    expect(cap.lines.join("\n")).toContain("did not resolve to a Workflow-templated item");
  });

  it("prints the failure human line when the field write throws", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue(null),
      setItemWorkflowState: vi.fn().mockRejectedValue(new Error("boom")),
    });
    installClient(client);

    const cap = captureInfo();
    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Draft",
      allowWrite: true,
    });
    cap.restore();

    expect(result.status).toBe("failed");
    expect(cap.lines.join("\n")).toContain("Failed to apply workflow: boom");
  });

  it("prints the already-attached human line in text mode", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "x",
        path: "/sitecore/content/x",
        workflowId: "{abcdef01-2345-6789-abcd-ef0123456789}",
        workflowName: "Editorial Workflow",
        stateId: "{11111111-1111-1111-1111-111111111111}",
        stateName: "Draft",
        stateIsFinal: false,
      }),
    });
    installClient(client);

    const cap = captureInfo();
    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Draft",
      allowWrite: true,
    });
    cap.restore();

    expect(result.status).toBe("skipped-already-attached");
    expect(cap.lines.join("\n")).toContain("Item already attached to workflow");
  });

  it("prints the state-not-found human line in text mode", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
    });
    installClient(client);

    const cap = captureInfo();
    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Nonexistent",
      allowWrite: true,
    });
    cap.restore();

    expect(result.status).toBe("skipped-state-not-found");
    expect(cap.lines.join("\n")).toContain("has no state named or matching 'Nonexistent'");
  });
});

describe("runWorkflowApply — displayName-absent fallback arms", () => {
  it("falls back to the workflow item name when displayName is unset (applied)", async () => {
    const detail = definitionNoDisplayName();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue(null),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
      setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("applied");
    // displayName undefined → workflowName / stateName fall back to `name`.
    expect(result.workflowName).toBe("Editorial");
    expect(result.stateName).toBe("Draft");
  });

  it("falls back to the workflow name for a state-not-found skip", async () => {
    const detail = definitionNoDisplayName();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      state: "Ghost",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-state-not-found");
    expect(result.message).toContain("Workflow 'Editorial'");
  });

  it("throws UNKNOWN naming the workflow by item name when __Initial state is unset", async () => {
    const detail = definitionNoDisplayName();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue(null),
    });
    installClient(client);

    await expect(
      runWorkflowApply({
        item: "/sitecore/content/x",
        workflow: "Editorial",
        allowWrite: true,
        json: true,
      })
    ).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("leaves stateName null when the initial state GUID matches no declared state", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getItemWorkflow: vi.fn().mockResolvedValue(null),
      // Initial state GUID points at a state NOT in `states[]`.
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("99999999-9999-9999-9999-999999999999"),
      setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    });
    installClient(client);

    const result = await runWorkflowApply({
      item: "/sitecore/content/x",
      workflow: "Editorial",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("applied");
    // No matching state → targetStateName stays null.
    expect(result.stateName).toBeNull();
  });

  it("reports what-if with a null stateName message when the initial state is unknown", async () => {
    const detail = definition();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
      findWorkflowDefinitionByName: vi
        .fn()
        .mockResolvedValue({ summary: { itemId: detail.itemId }, duplicateMatches: 1 }),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("99999999-9999-9999-9999-999999999999"),
    });
    installClient(client);

    // GUID item ref → exercises the `itemSelector.itemId` arm of the
    // what-if message fallback.
    const result = await runWorkflowApply({
      item: "{cccccccc-cccc-cccc-cccc-cccccccccccc}",
      workflow: "Editorial",
      whatIf: true,
      json: true,
    });

    expect(result.status).toBe("what-if");
    expect(result.stateName).toBeNull();
    expect(result.message).toContain("at state '?'");
  });
});
