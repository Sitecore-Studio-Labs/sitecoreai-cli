/**
 * `src/agents/api/custom-mcps.ts` — custom MCP server registration.
 *
 * The transport (`agentsRequest`) is exercised directly in `request.test.ts`;
 * here it is mocked so each custom-MCP operation's request shape (path,
 * method, body, id URL-encoding) and response handling can be asserted in
 * isolation.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsSession } from "../../../../src/agents/session/types";
import type { CustomMcp } from "../../../../src/agents/api/schema";

vi.mock("../../../../src/agents/api/request", () => ({
  agentsRequest: vi.fn(),
}));

let customMcps: typeof import("../../../../src/agents/api/custom-mcps");
let request: typeof import("../../../../src/agents/api/request");

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

const mcpFixture = (over: Partial<CustomMcp> = {}): CustomMcp =>
  ({ id: "m-1", name: "Weather", url: "https://mcp.example.com", ...over }) as CustomMcp;

beforeAll(async () => {
  customMcps = await import("../../../../src/agents/api/custom-mcps");
  request = await import("../../../../src/agents/api/request");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCustomMcps", () => {
  it("returns the array when the API responds with an MCP list", async () => {
    const list = [mcpFixture({ id: "m-1" }), mcpFixture({ id: "m-2", name: "Maps" })];
    vi.mocked(request.agentsRequest).mockResolvedValue(list as never);

    const result = await customMcps.listCustomMcps(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/custom-mcps");
    expect(result).toEqual(list);
  });

  it("coerces a non-array response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ unexpected: true } as never);
    expect(await customMcps.listCustomMcps(session)).toEqual([]);
  });

  it("coerces a null response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await customMcps.listCustomMcps(session)).toEqual([]);
  });
});

describe("getCustomMcp", () => {
  it("finds an MCP by id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      mcpFixture({ id: "m-1", name: "Weather" }),
      mcpFixture({ id: "m-2", name: "Maps" }),
    ] as never);

    const found = await customMcps.getCustomMcp(session, "m-2");
    expect(found?.id).toBe("m-2");
  });

  it("finds an MCP by name when no id matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      mcpFixture({ id: "m-1", name: "Weather" }),
    ] as never);

    const found = await customMcps.getCustomMcp(session, "Weather");
    expect(found?.id).toBe("m-1");
  });

  it("returns undefined when neither id nor name matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      mcpFixture({ id: "m-1", name: "Weather" }),
    ] as never);

    expect(await customMcps.getCustomMcp(session, "missing")).toBeUndefined();
  });

  it("returns undefined when the MCP list is empty", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([] as never);
    expect(await customMcps.getCustomMcp(session, "m-1")).toBeUndefined();
  });
});

describe("createCustomMcp", () => {
  it("POSTs name and url and returns the created MCP", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(mcpFixture() as never);

    const result = await customMcps.createCustomMcp(session, {
      name: "Weather",
      url: "https://mcp.example.com",
    });

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/custom-mcps", {
      method: "POST",
      body: { name: "Weather", url: "https://mcp.example.com" },
    });
    expect(result.id).toBe("m-1");
  });
});

describe("updateCustomMcp", () => {
  it("PUTs name and url to the id-scoped path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await customMcps.updateCustomMcp(session, {
      id: "m-1",
      name: "Weather v2",
      url: "https://mcp.example.com/v2",
    });

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/custom-mcps/m-1", {
      method: "PUT",
      body: { name: "Weather v2", url: "https://mcp.example.com/v2" },
    });
  });

  it("url-encodes an MCP id containing reserved characters", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await customMcps.updateCustomMcp(session, { id: "m/1 a", name: "n", url: "u" });

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/custom-mcps/m%2F1%20a");
  });
});

describe("deleteCustomMcp", () => {
  it("DELETEs the id-scoped path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await customMcps.deleteCustomMcp(session, "m-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/custom-mcps/m-1", {
      method: "DELETE",
    });
  });

  it("url-encodes the MCP id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await customMcps.deleteCustomMcp(session, "m/1");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/custom-mcps/m%2F1");
  });
});

describe("getCustomMcpAuth", () => {
  it("GETs the id-scoped /auth path and returns the parsed body", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ authorized: true } as never);

    const result = await customMcps.getCustomMcpAuth(session, "m-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/custom-mcps/m-1/auth");
    expect(result).toEqual({ authorized: true });
  });

  it("url-encodes the MCP id in the /auth path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await customMcps.getCustomMcpAuth(session, "m/1");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/custom-mcps/m%2F1/auth");
  });
});
