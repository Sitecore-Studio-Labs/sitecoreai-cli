import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → session bridge so the kind never reads real config or
// touches the keychain. `agent.kind.ts` imports `resolveAgentsSession`
// from `./client` — i.e. src/agents/recipe/client.ts.
const resolveAgentsSession = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/agents/recipe/client", () => ({ resolveAgentsSession }));

// Mock the Agentic Studio API surface the kind composes.
const agentsApi = vi.hoisted(() => ({
  createAgent: vi.fn(),
  listAgents: vi.fn(),
  updateAgent: vi.fn(),
}));
vi.mock("../../../../src/agents/api/agents", () => agentsApi);

const skillsApi = vi.hoisted(() => ({ listSkills: vi.fn() }));
vi.mock("../../../../src/agents/api/skills", () => skillsApi);

import { agentKind, buildAgentConfig } from "../../../../src/agents/recipe/agent.kind";
import { AgentRecipeSchema } from "../../../../src/agents/recipe/agent.schema";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "agent", id: "Researcher" } as const;

const recipe = (input: unknown) => AgentRecipeSchema.parse(input);

const makeAgent = (overrides: Record<string, unknown> = {}) => ({
  id: "agent-id-1",
  slug: "researcher",
  name: "Researcher",
  description: "Does research",
  prompt: "You research things.",
  tags: ["beta"],
  config: {
    executionMode: "standard",
    tools: {},
    skills: [],
    output: { format: "text" },
  },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveAgentsSession.mockResolvedValue(SESSION);
  skillsApi.listSkills.mockResolvedValue([]);
});

describe("agentKind — recipe-kind contract", () => {
  it("exposes the name, schema, and the three operations", () => {
    expect(agentKind.name).toBe("agent");
    expect(agentKind.schema).toBe(AgentRecipeSchema);
    expect(typeof agentKind.readCurrent).toBe("function");
    expect(typeof agentKind.plan).toBe("function");
    expect(typeof agentKind.apply).toBe("function");
  });
});

describe("buildAgentConfig", () => {
  it("resolves skill slugs to ids against the live skills catalog", async () => {
    skillsApi.listSkills.mockResolvedValue([
      { id: "skill-id-1", slug: "tone-of-voice" },
      { id: "skill-id-2", slug: "research-style" },
    ]);

    const config = await buildAgentConfig(
      SESSION,
      recipe({ name: "R", skills: ["tone-of-voice", "research-style"] })
    );

    expect(config.skills).toEqual(["skill-id-1", "skill-id-2"]);
    expect(config.executionMode).toBe("standard");
    expect(config.defaultContext).toEqual([]);
  });

  it("passes a skill slug through unchanged when the catalog has no match", async () => {
    skillsApi.listSkills.mockResolvedValue([{ id: "skill-id-1", slug: "tone-of-voice" }]);

    const config = await buildAgentConfig(SESSION, recipe({ name: "R", skills: ["unknown-slug"] }));

    expect(config.skills).toEqual(["unknown-slug"]);
  });
});

describe("agentKind.readCurrent", () => {
  it("returns null when no agent matches the ref name", async () => {
    agentsApi.listAgents.mockResolvedValue([makeAgent({ name: "Other", slug: "other" })]);

    expect(await agentKind.readCurrent(ref, ctx)).toBeNull();
  });

  it("projects a live agent into the recipe shape, mapping skill ids to slugs", async () => {
    agentsApi.listAgents.mockResolvedValue([
      makeAgent({
        config: {
          executionMode: "standard",
          tools: { enableWebSearch: true },
          skills: ["skill-id-1"],
          output: { format: "text" },
        },
      }),
    ]);
    skillsApi.listSkills.mockResolvedValue([{ id: "skill-id-1", slug: "tone-of-voice" }]);

    const result = await agentKind.readCurrent(ref, ctx);

    expect(result).toMatchObject({
      name: "Researcher",
      description: "Does research",
      tools: { enableWebSearch: true },
      skills: ["tone-of-voice"],
    });
  });

  it("matches an agent by slug when the ref id is the slug, not the display name", async () => {
    agentsApi.listAgents.mockResolvedValue([
      makeAgent({ name: "Different Name", slug: "researcher" }),
    ]);

    const result = await agentKind.readCurrent({ kind: "agent", id: "researcher" }, ctx);

    expect(result?.name).toBe("Different Name");
  });

  it("falls back to the slug for the recipe name when the agent has no name", async () => {
    agentsApi.listAgents.mockResolvedValue([makeAgent({ name: undefined, slug: "researcher" })]);

    const result = await agentKind.readCurrent({ kind: "agent", id: "researcher" }, ctx);

    expect(result?.name).toBe("researcher");
  });

  it("keeps an unmapped skill id verbatim when the catalog has no slug for it", async () => {
    agentsApi.listAgents.mockResolvedValue([
      makeAgent({
        config: {
          executionMode: "standard",
          tools: {},
          skills: ["orphan-id"],
          output: { format: "text" },
        },
      }),
    ]);
    skillsApi.listSkills.mockResolvedValue([]);

    const result = await agentKind.readCurrent(ref, ctx);

    expect(result?.skills).toEqual(["orphan-id"]);
  });

  it("defaults executionMode and output when the live agent omits a config", async () => {
    agentsApi.listAgents.mockResolvedValue([makeAgent({ config: undefined })]);

    const result = await agentKind.readCurrent(ref, ctx);

    expect(result?.executionMode).toBe("standard");
    expect(result?.output).toEqual({ format: "text" });
  });
});

describe("agentKind.plan", () => {
  it("plans a create when the agent does not exist remotely", async () => {
    agentsApi.listAgents.mockResolvedValue([]);

    const plan = await agentKind.plan(recipe({ name: "Researcher" }), ref, ctx);

    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "agent.Researcher" });
  });

  it("plans an update when a field differs from the live agent", async () => {
    agentsApi.listAgents.mockResolvedValue([makeAgent({ prompt: "old prompt" })]);

    const plan = await agentKind.plan(
      recipe({
        name: "Researcher",
        description: "Does research",
        prompt: "new prompt",
        tags: ["beta"],
      }),
      ref,
      ctx
    );

    expect(plan.changes[0].kind).toBe("update");
  });
});

describe("agentKind.apply — noop / empty plan", () => {
  it("returns nothing applied and nothing skipped for an empty plan", async () => {
    const result = await agentKind.apply({ changes: [] }, ref, ctx);

    expect(result).toEqual({ applied: [], skipped: [] });
    expect(agentsApi.createAgent).not.toHaveBeenCalled();
  });

  it("skips a noop change without touching the API", async () => {
    const result = await agentKind.apply(
      { changes: [{ kind: "noop", path: "agent.Researcher", summary: "no change" }] },
      ref,
      ctx
    );

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(agentsApi.createAgent).not.toHaveBeenCalled();
    expect(agentsApi.updateAgent).not.toHaveBeenCalled();
  });
});

describe("agentKind.apply — create", () => {
  it("creates the agent from the change's meta.recipe", async () => {
    agentsApi.createAgent.mockResolvedValue(makeAgent());

    const result = await agentKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "agent.Researcher",
            summary: "create agent",
            meta: { recipe: recipe({ name: "Researcher", prompt: "p" }) },
          },
        ],
      },
      ref,
      ctx
    );

    expect(agentsApi.createAgent).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ name: "Researcher", prompt: "p" })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("falls back to parsing change.after when meta.recipe is absent", async () => {
    agentsApi.createAgent.mockResolvedValue(makeAgent());

    await agentKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "agent.Researcher",
            summary: "create agent",
            after: { name: "Researcher", prompt: "from after" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(agentsApi.createAgent).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ name: "Researcher", prompt: "from after" })
    );
  });
});

describe("agentKind.apply — update", () => {
  it("resolves the live agent id by name and updates it", async () => {
    agentsApi.listAgents.mockResolvedValue([makeAgent()]);
    agentsApi.updateAgent.mockResolvedValue(undefined);

    const result = await agentKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "agent.Researcher",
            summary: "update agent",
            meta: { recipe: recipe({ name: "Researcher", prompt: "updated" }) },
          },
        ],
      },
      ref,
      ctx
    );

    expect(agentsApi.updateAgent).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ id: "agent-id-1", name: "Researcher" })
    );
    expect(result.applied).toHaveLength(1);
  });

  it("throws INPUT_INVALID when the update target does not exist remotely", async () => {
    agentsApi.listAgents.mockResolvedValue([]);

    await expect(
      agentKind.apply(
        {
          changes: [
            {
              kind: "update",
              path: "agent.Researcher",
              summary: "update agent",
              meta: { recipe: recipe({ name: "Researcher" }) },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(agentsApi.updateAgent).not.toHaveBeenCalled();
  });
});
