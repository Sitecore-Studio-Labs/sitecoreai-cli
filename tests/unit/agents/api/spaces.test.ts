/**
 * `src/agents/api/spaces.ts` — run-container (space) creation and config.
 *
 * The transport (`agentsRequest`) is exercised directly in `request.test.ts`;
 * here it is mocked so each space operation's request shape (path, method,
 * body) and the defensive `?? {}` response normalization can be asserted in
 * isolation. `node:crypto`'s `randomUUID` is stubbed for deterministic ids.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsSession } from "../../../../src/agents/session/types";
import type { SpaceConfig } from "../../../../src/agents/api/schema";

vi.mock("../../../../src/agents/api/request", () => ({
  agentsRequest: vi.fn(),
}));

let uuidCounter = 0;
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
}));

let spaces: typeof import("../../../../src/agents/api/spaces");
let request: typeof import("../../../../src/agents/api/request");

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

beforeAll(async () => {
  spaces = await import("../../../../src/agents/api/spaces");
  request = await import("../../../../src/agents/api/request");
});

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
});

describe("buildSpaceConfig", () => {
  it("builds a single-agent config bound to the launch target", () => {
    const config = spaces.buildSpaceConfig("My Space", "sales", "agent");

    expect(config).toMatchObject({
      purpose: "custom",
      workPattern: "custom-orchestration",
      spaceName: "My Space",
      globalContext: { objective: "" },
      items: [],
      agentExecutionMode: "sequential",
      launchTarget: { kind: "agent", graphType: "sales" },
    });
    expect(config.agents).toEqual([{ slug: "sales", title: "My Space", instanceId: "uuid-1" }]);
  });

  it("threads a 'flow' kind into the launch target", () => {
    const config = spaces.buildSpaceConfig("Flow Space", "flow-7", "flow");
    expect(config.launchTarget).toEqual({ kind: "flow", graphType: "flow-7" });
  });
});

describe("createSpace", () => {
  it("POSTs the space then PUTs its config, returning spaceId + config", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    const result = await spaces.createSpace(session, { title: "My Space", target: "sales" });

    // randomUUID is called for the space id first, then for the agent instanceId.
    expect(result.spaceId).toBe("uuid-1");
    expect(result.config.launchTarget).toEqual({ kind: "agent", graphType: "sales" });

    const calls = vi.mocked(request.agentsRequest).mock.calls;
    expect(calls[0]).toEqual([
      session,
      "/api/spaces",
      {
        method: "POST",
        body: { id: "uuid-1", title: "My Space", spaceConfig: result.config },
      },
    ]);
    expect(calls[1]).toEqual([
      session,
      "/api/spaces/uuid-1/config",
      { method: "PUT", body: { spaceConfig: result.config } },
    ]);
  });

  it("defaults targetKind to 'agent' when omitted", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    const result = await spaces.createSpace(session, { title: "S", target: "sales" });
    expect(result.config.launchTarget?.kind).toBe("agent");
  });

  it("honors an explicit 'flow' targetKind", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    const result = await spaces.createSpace(session, {
      title: "S",
      target: "flow-7",
      targetKind: "flow",
    });
    expect(result.config.launchTarget).toEqual({ kind: "flow", graphType: "flow-7" });
  });
});

describe("getSpaceConfig", () => {
  it("GETs the id-scoped /config path and unwraps spaceConfig", async () => {
    const config = { spaceName: "My Space" } as SpaceConfig;
    vi.mocked(request.agentsRequest).mockResolvedValue({ spaceConfig: config } as never);

    const result = await spaces.getSpaceConfig(session, "sp-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/spaces/sp-1/config");
    expect(result).toEqual(config);
  });

  it("returns an empty object when spaceConfig is absent", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({} as never);
    expect(await spaces.getSpaceConfig(session, "sp-1")).toEqual({});
  });

  it("returns an empty object when the response is null", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await spaces.getSpaceConfig(session, "sp-1")).toEqual({});
  });

  it("url-encodes the space id in the /config path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({} as never);

    await spaces.getSpaceConfig(session, "sp/1 a");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/spaces/sp%2F1%20a/config");
  });
});

describe("getSpaceArtifacts", () => {
  it("GETs the id-scoped /artifacts path and returns the parsed body", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ ok: true, data: [1] } as never);

    const result = await spaces.getSpaceArtifacts(session, "sp-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/spaces/sp-1/artifacts");
    expect(result).toEqual({ ok: true, data: [1] });
  });

  it("returns an empty object when the response is null", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await spaces.getSpaceArtifacts(session, "sp-1")).toEqual({});
  });

  it("url-encodes the space id in the /artifacts path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({} as never);

    await spaces.getSpaceArtifacts(session, "sp/1");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/spaces/sp%2F1/artifacts");
  });
});

describe("updateSpaceConfig", () => {
  it("PUTs the config to the id-scoped /config path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);
    const config = { spaceName: "Renamed" } as SpaceConfig;

    await spaces.updateSpaceConfig(session, "sp-1", config);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/spaces/sp-1/config", {
      method: "PUT",
      body: { spaceConfig: config },
    });
  });

  it("url-encodes the space id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await spaces.updateSpaceConfig(session, "sp/1", {} as SpaceConfig);

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/spaces/sp%2F1/config");
  });
});
