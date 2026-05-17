/**
 * `src/agents/api/agents.ts` — agent CRUD against the Agentic Studio BFF.
 *
 * The transport (`agentsRequest`) is exercised directly in `request.test.ts`;
 * here it is mocked so each agent operation's request shape (path, method,
 * body) and response handling — including the `[{agent}]` create unwrap and
 * the optional-field `?? ""` / `?? []` normalization — can be asserted in
 * isolation.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsSession } from "../../../../src/agents/session/types";
import type { Agent, AgentConfig } from "../../../../src/agents/api/schema";

vi.mock("../../../../src/agents/api/request", () => ({
  agentsRequest: vi.fn(),
}));

let agents: typeof import("../../../../src/agents/api/agents");
let request: typeof import("../../../../src/agents/api/request");

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

const config: AgentConfig = {
  executionMode: "standard",
  tools: {} as never,
  defaultContext: [],
  skills: [],
  output: {} as never,
};

const agentFixture = (over: Partial<Agent> = {}): Agent =>
  ({ id: "a-1", slug: "sales", name: "Sales", ...over }) as Agent;

beforeAll(async () => {
  agents = await import("../../../../src/agents/api/agents");
  request = await import("../../../../src/agents/api/request");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAgents", () => {
  it("returns the array when the API responds with an agent list", async () => {
    const list = [agentFixture({ id: "a-1" }), agentFixture({ id: "a-2", slug: "ops" })];
    vi.mocked(request.agentsRequest).mockResolvedValue(list as never);

    const result = await agents.listAgents(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/agents");
    expect(result).toEqual(list);
  });

  it("coerces a non-array response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ unexpected: true } as never);
    expect(await agents.listAgents(session)).toEqual([]);
  });

  it("coerces a null response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await agents.listAgents(session)).toEqual([]);
  });
});

describe("getAgent", () => {
  it("finds an agent by id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      agentFixture({ id: "a-1", slug: "sales" }),
      agentFixture({ id: "a-2", slug: "ops" }),
    ] as never);

    const found = await agents.getAgent(session, "a-2");
    expect(found?.id).toBe("a-2");
  });

  it("finds an agent by slug when no id matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      agentFixture({ id: "a-1", slug: "sales" }),
    ] as never);

    const found = await agents.getAgent(session, "sales");
    expect(found?.id).toBe("a-1");
  });

  it("returns undefined when neither id nor slug matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      agentFixture({ id: "a-1", slug: "sales" }),
    ] as never);

    expect(await agents.getAgent(session, "missing")).toBeUndefined();
  });

  it("returns undefined when the agent list is empty", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([] as never);
    expect(await agents.getAgent(session, "a-1")).toBeUndefined();
  });
});

describe("createAgent", () => {
  it("POSTs every field with isPredefined false", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([agentFixture()] as never);

    const result = await agents.createAgent(session, {
      name: "Sales",
      description: "Q3 numbers",
      prompt: "Help with sales",
      tags: ["sales", "q3"],
      config,
    });

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/agents", {
      method: "POST",
      body: {
        name: "Sales",
        description: "Q3 numbers",
        prompt: "Help with sales",
        tags: ["sales", "q3"],
        config,
        isPredefined: false,
      },
    });
    expect(result.id).toBe("a-1");
  });

  it("normalizes missing description/prompt/tags to '', '', []", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([agentFixture()] as never);

    await agents.createAgent(session, { name: "Sales", config });

    const body = vi.mocked(request.agentsRequest).mock.calls[0][2]?.body as {
      description: unknown;
      prompt: unknown;
      tags: unknown;
    };
    expect(body.description).toBe("");
    expect(body.prompt).toBe("");
    expect(body.tags).toEqual([]);
  });

  it("unwraps the single-element [{agent}] array the BFF returns", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([agentFixture({ id: "wrapped" })] as never);

    const result = await agents.createAgent(session, { name: "Sales", config });
    expect(result.id).toBe("wrapped");
  });

  it("passes through an unwrapped (non-array) agent response", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(agentFixture({ id: "bare" }) as never);

    const result = await agents.createAgent(session, { name: "Sales", config });
    expect(result.id).toBe("bare");
  });
});

describe("updateAgent", () => {
  it("PUTs id, name, description, and config to /api/agents", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await agents.updateAgent(session, {
      id: "a-1",
      name: "Sales",
      description: "updated",
      config,
    });

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/agents", {
      method: "PUT",
      body: { id: "a-1", name: "Sales", description: "updated", config },
    });
  });

  it("normalizes a missing description to an empty string", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await agents.updateAgent(session, { id: "a-1", name: "Sales", config });

    const body = vi.mocked(request.agentsRequest).mock.calls[0][2]?.body as {
      description: unknown;
    };
    expect(body.description).toBe("");
  });
});

describe("duplicateAgent", () => {
  it("POSTs the new name to the id-scoped path and unwraps the array", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([agentFixture({ id: "dup" })] as never);

    const result = await agents.duplicateAgent(session, "a-1", "Sales Copy");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/agents/a-1", {
      method: "POST",
      body: { name: "Sales Copy" },
    });
    expect(result.id).toBe("dup");
  });

  it("url-encodes an agent id containing reserved characters", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([agentFixture()] as never);

    await agents.duplicateAgent(session, "a/b c", "copy");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/agents/a%2Fb%20c");
  });
});

describe("deleteAgent", () => {
  it("DELETEs the id-scoped path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await agents.deleteAgent(session, "a-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/agents/a-1", {
      method: "DELETE",
    });
  });

  it("url-encodes the agent id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await agents.deleteAgent(session, "a/1");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/agents/a%2F1");
  });
});
