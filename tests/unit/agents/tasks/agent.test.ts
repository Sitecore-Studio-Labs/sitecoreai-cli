import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";

vi.mock("../../../../src/agents/tasks/shared", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/agents/tasks/shared")>(
    "../../../../src/agents/tasks/shared"
  );
  return { ...actual, prepare: vi.fn() };
});
// `vi.mock` factories use RELATIVE paths — the `@/` alias is not resolved
// inside the factory. `agent.ts` imports `loadRecipe` from `@/sync`, which
// resolves to `src/sync/index.ts`.
vi.mock("../../../../src/sync/index", () => ({ loadRecipe: vi.fn() }));
vi.mock("../../../../src/agents/api/agents", () => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  duplicateAgent: vi.fn(),
  getAgent: vi.fn(),
  listAgents: vi.fn(),
  updateAgent: vi.fn(),
}));
vi.mock("../../../../src/agents/api/runs", () => ({ runAgent: vi.fn() }));
vi.mock("../../../../src/agents/api/spaces", () => ({ getSpaceArtifacts: vi.fn() }));
vi.mock("../../../../src/agents/recipe/agent.kind", () => ({ buildAgentConfig: vi.fn() }));

import {
  runAgentCreate,
  runAgentDelete,
  runAgentDuplicate,
  runAgentGet,
  runAgentList,
  runAgentRun,
  runAgentUpdate,
} from "../../../../src/agents/tasks/agent";
import { prepare } from "../../../../src/agents/tasks/shared";
import { loadRecipe } from "../../../../src/sync/index";
import {
  createAgent,
  deleteAgent,
  duplicateAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "../../../../src/agents/api/agents";
import { runAgent } from "../../../../src/agents/api/runs";
import { getSpaceArtifacts } from "../../../../src/agents/api/spaces";
import { buildAgentConfig } from "../../../../src/agents/recipe/agent.kind";
import { Logger } from "../../../../src/shared/logger";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

const makeAgent = (overrides: Record<string, unknown> = {}) => ({
  id: "agent-id-1",
  slug: "research-agent",
  name: "Research Agent",
  description: "Does research",
  prompt: "You research things.",
  tags: ["beta"],
  ...overrides,
});

const RECIPE = {
  name: "Research Agent",
  description: "Does research",
  prompt: "You research things.",
  tags: ["beta"],
  executionMode: "standard",
  tools: {},
  skills: [],
  output: { format: "text" },
};

let stdout: ReturnType<typeof vi.spyOn>;
let consolaInfo: ReturnType<typeof vi.spyOn>;

/** json mode → quiet logger; human mode → consola-visible logger. */
const usePrepare = (json: boolean): void => {
  vi.mocked(prepare).mockResolvedValue({
    logger: new Logger(false, false, json, false),
    session: SESSION,
    envName: "test",
  } as never);
};

/** Last JSON document written to stdout. */
const jsonOut = (): unknown => JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null"));

/** Every human line routed through consola.info. */
const humanLines = (): string[] => consolaInfo.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  consolaInfo = vi.spyOn(consola, "info").mockReturnValue(undefined as never);
  vi.mocked(buildAgentConfig).mockResolvedValue({ executionMode: "standard" } as never);
});

afterEach(() => {
  stdout.mockRestore();
  consolaInfo.mockRestore();
});

describe("runAgentList", () => {
  it("writes the agent array as JSON in --json mode", async () => {
    usePrepare(true);
    vi.mocked(listAgents).mockResolvedValue([makeAgent()] as never);

    await runAgentList({} as never);

    expect(jsonOut()).toMatchObject([{ slug: "research-agent" }]);
  });

  it("renders a human one-line summary per agent", async () => {
    usePrepare(false);
    vi.mocked(listAgents).mockResolvedValue([makeAgent(), makeAgent()] as never);

    await runAgentList({} as never);

    const lines = humanLines();
    expect(lines.some((l) => l.includes("2 agent(s)"))).toBe(true);
    expect(lines.some((l) => l.includes("research-agent"))).toBe(true);
  });
});

describe("runAgentGet", () => {
  it("renders the matched agent", async () => {
    usePrepare(true);
    vi.mocked(getAgent).mockResolvedValue(makeAgent() as never);

    await runAgentGet({ idOrSlug: "research-agent" } as never);

    expect(jsonOut()).toMatchObject({ id: "agent-id-1" });
  });

  it("throws INPUT_INVALID when the agent is not found", async () => {
    usePrepare(false);
    vi.mocked(getAgent).mockResolvedValue(undefined as never);

    await expect(runAgentGet({ idOrSlug: "ghost" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});

describe("runAgentCreate", () => {
  it("throws INPUT_INVALID when an agent with the recipe name already exists", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue(RECIPE as never);
    vi.mocked(listAgents).mockResolvedValue([makeAgent()] as never);

    await expect(runAgentCreate({ file: "a.yaml" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("plans without calling the API in --what-if mode", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(RECIPE as never);
    vi.mocked(listAgents).mockResolvedValue([] as never);

    await runAgentCreate({ file: "a.yaml", whatIf: true } as never);

    expect(jsonOut()).toMatchObject({ plan: { create: "Research Agent" } });
    expect(createAgent).not.toHaveBeenCalled();
    expect(buildAgentConfig).not.toHaveBeenCalled();
  });

  it("creates the agent with the built config when the name is free", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(RECIPE as never);
    vi.mocked(listAgents).mockResolvedValue([] as never);
    vi.mocked(createAgent).mockResolvedValue(makeAgent() as never);

    await runAgentCreate({ file: "a.yaml" } as never);

    expect(createAgent).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ name: "Research Agent", config: { executionMode: "standard" } })
    );
    expect(jsonOut()).toMatchObject({ ok: true });
  });
});

describe("runAgentUpdate", () => {
  it("throws INPUT_INVALID when the target agent does not exist", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue(RECIPE as never);
    vi.mocked(getAgent).mockResolvedValue(undefined as never);

    await expect(
      runAgentUpdate({ idOrSlug: "ghost", file: "a.yaml" } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(updateAgent).not.toHaveBeenCalled();
  });

  it("plans without calling updateAgent in --what-if mode", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(RECIPE as never);
    vi.mocked(getAgent).mockResolvedValue(makeAgent() as never);

    await runAgentUpdate({ idOrSlug: "research-agent", file: "a.yaml", whatIf: true } as never);

    expect(jsonOut()).toMatchObject({ plan: { update: "agent-id-1" } });
    expect(updateAgent).not.toHaveBeenCalled();
  });

  it("updates the existing agent by id", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(RECIPE as never);
    vi.mocked(getAgent).mockResolvedValue(makeAgent() as never);
    vi.mocked(updateAgent).mockResolvedValue(undefined as never);

    await runAgentUpdate({ idOrSlug: "research-agent", file: "a.yaml" } as never);

    expect(updateAgent).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ id: "agent-id-1", config: { executionMode: "standard" } })
    );
    expect(jsonOut()).toMatchObject({ updated: "agent-id-1" });
  });
});

describe("runAgentDuplicate", () => {
  it("throws INPUT_INVALID when the source agent is missing", async () => {
    usePrepare(false);
    vi.mocked(getAgent).mockResolvedValue(undefined as never);

    await expect(
      runAgentDuplicate({ idOrSlug: "ghost", name: "Copy" } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("plans without calling the API in --what-if mode", async () => {
    usePrepare(true);
    vi.mocked(getAgent).mockResolvedValue(makeAgent() as never);

    await runAgentDuplicate({ idOrSlug: "research-agent", name: "Copy", whatIf: true } as never);

    expect(jsonOut()).toMatchObject({ plan: { duplicate: "agent-id-1", as: "Copy" } });
    expect(duplicateAgent).not.toHaveBeenCalled();
  });

  it("duplicates the agent under the new name", async () => {
    usePrepare(true);
    vi.mocked(getAgent).mockResolvedValue(makeAgent() as never);
    vi.mocked(duplicateAgent).mockResolvedValue(makeAgent({ id: "copy-id" }) as never);

    await runAgentDuplicate({ idOrSlug: "research-agent", name: "Copy" } as never);

    expect(duplicateAgent).toHaveBeenCalledWith(SESSION, "agent-id-1", "Copy");
    expect(jsonOut()).toMatchObject({ ok: true });
  });
});

describe("runAgentDelete", () => {
  it("throws INPUT_INVALID when the agent does not exist", async () => {
    usePrepare(false);
    vi.mocked(getAgent).mockResolvedValue(undefined as never);

    await expect(runAgentDelete({ idOrSlug: "ghost" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(deleteAgent).not.toHaveBeenCalled();
  });

  it("plans without deleting in --what-if mode", async () => {
    usePrepare(true);
    vi.mocked(getAgent).mockResolvedValue(makeAgent() as never);

    await runAgentDelete({ idOrSlug: "research-agent", whatIf: true } as never);

    expect(jsonOut()).toMatchObject({ plan: { delete: "agent-id-1" } });
    expect(deleteAgent).not.toHaveBeenCalled();
  });

  it("deletes the agent by id", async () => {
    usePrepare(true);
    vi.mocked(getAgent).mockResolvedValue(makeAgent() as never);
    vi.mocked(deleteAgent).mockResolvedValue(undefined as never);

    await runAgentDelete({ idOrSlug: "research-agent" } as never);

    expect(deleteAgent).toHaveBeenCalledWith(SESSION, "agent-id-1");
    expect(jsonOut()).toMatchObject({ deleted: "agent-id-1" });
  });
});

describe("runAgentRun", () => {
  async function* eventStream(...events: unknown[]): AsyncIterable<unknown> {
    for (const event of events) yield event;
  }

  it("collects every streamed event into the JSON envelope", async () => {
    usePrepare(true);
    vi.mocked(runAgent).mockResolvedValue({
      spaceId: "space-9",
      events: eventStream({ type: "start" }, { type: "text-delta", delta: "hi" }),
    } as never);
    vi.mocked(getSpaceArtifacts).mockResolvedValue({ data: { result: "ok" } } as never);

    await runAgentRun({ agentSlug: "research-agent", message: "go" } as never);

    expect(jsonOut()).toMatchObject({
      spaceId: "space-9",
      events: [{ type: "start" }, { type: "text-delta", delta: "hi" }],
      artifacts: { result: "ok" },
    });
  });

  it("streams text-delta and artifactDelta chunks to stdout in human mode", async () => {
    usePrepare(false);
    vi.mocked(runAgent).mockResolvedValue({
      spaceId: "space-9",
      events: eventStream(
        { type: "text-delta", delta: "Hello " },
        { type: "data-artifactDelta", data: { content: "world" } },
        { type: "ignored" }
      ),
    } as never);
    vi.mocked(getSpaceArtifacts).mockResolvedValue({ data: { final: true } } as never);

    await runAgentRun({ agentSlug: "research-agent", message: "go" } as never);

    const written = stdout.mock.calls.map((c) => String(c[0]));
    expect(written).toContain("Hello ");
    expect(written).toContain("world");
  });

  it("treats a failed artifacts read as undefined and still completes", async () => {
    usePrepare(true);
    vi.mocked(runAgent).mockResolvedValue({
      spaceId: "space-9",
      events: eventStream({ type: "start" }),
    } as never);
    vi.mocked(getSpaceArtifacts).mockRejectedValue(new Error("artifacts 500"));

    await runAgentRun({ agentSlug: "research-agent", message: "go" } as never);

    const envelope = jsonOut() as { artifacts?: unknown };
    expect(envelope.artifacts).toBeUndefined();
  });
});
