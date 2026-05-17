import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentsRequest,
  agentsServerAction,
  agentsStream,
} from "../../../../src/agents/api/request";
import type { AgentsSession } from "../../../../src/agents/session/types";

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

const stubFetch = (body: string, status: number): void => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agentsRequest", () => {
  it("parses a 2xx JSON response", async () => {
    stubFetch('{"hello":"world"}', 200);
    expect(await agentsRequest(session, "/api/x")).toEqual({ hello: "world" });
  });

  it("maps 401 to AUTH_REQUIRED", async () => {
    stubFetch('{"error":"unauthorized"}', 401);
    await expect(agentsRequest(session, "/api/x")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("maps a 403 Builder-role rejection to AUTH_DENIED", async () => {
    stubFetch('{"error":"Builder role and license required"}', 403);
    await expect(agentsRequest(session, "/api/x")).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
  });

  it("maps other non-2xx responses to AGENTS_API_FAILED", async () => {
    stubFetch('{"error":"boom"}', 500);
    await expect(agentsRequest(session, "/api/x")).rejects.toMatchObject({
      code: "AGENTS_API_FAILED",
    });
  });

  it("maps a 403 WITHOUT a Builder mention to AGENTS_API_FAILED (not AUTH_DENIED)", async () => {
    stubFetch('{"error":"forbidden"}', 403);
    await expect(agentsRequest(session, "/api/x")).rejects.toMatchObject({
      code: "AGENTS_API_FAILED",
    });
  });

  it("surfaces the body's `error` string as the AGENTS_API_FAILED message", async () => {
    stubFetch('{"error":"schema rejected"}', 422);
    await expect(agentsRequest(session, "/api/x")).rejects.toMatchObject({
      code: "AGENTS_API_FAILED",
      message: "schema rejected",
    });
  });

  it("returns undefined for an empty 2xx body", async () => {
    stubFetch("", 200);
    expect(await agentsRequest(session, "/api/x")).toBeUndefined();
  });

  it("throws AGENTS_API_FAILED when a 2xx body is not JSON", async () => {
    stubFetch("<html>not json</html>", 200);
    await expect(agentsRequest(session, "/api/x")).rejects.toMatchObject({
      code: "AGENTS_API_FAILED",
    });
  });

  it("wraps a transport-layer fetch rejection as NETWORK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(agentsRequest(session, "/api/x")).rejects.toMatchObject({
      code: "NETWORK",
    });
  });

  it("appends defined query params and drops undefined ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await agentsRequest(session, "/api/x", { query: { a: "1", b: 2, c: undefined } });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("?a=1&b=2");
    expect(calledUrl).not.toContain("c=");
  });

  it("sets a Content-Type header and serializes the body for a write request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await agentsRequest(session, "/api/x", { method: "post", body: { name: "Hero" } });

    const init = fetchMock.mock.calls[0][1] as {
      method: string;
      body: string;
      headers: Record<string, string>;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"name":"Hero"}');
  });
});

describe("agentsStream", () => {
  async function* collect(it: AsyncIterable<string>): AsyncIterable<string> {
    yield* it;
  }

  it("yields decoded chunks from a streaming 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("data: one\n\ndata: two\n\n", { status: 200 }))
    );

    const out: string[] = [];
    for await (const chunk of collect(agentsStream(session, "/api/chatv2", { body: {} }))) {
      out.push(chunk);
    }
    expect(out.join("")).toContain("data: one");
  });

  it("maps a non-2xx stream response to a ScaiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }))
    );

    const iterate = async (): Promise<void> => {
      for await (const _chunk of agentsStream(session, "/api/chatv2", { body: {} })) {
        void _chunk;
      }
    };
    await expect(iterate()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("wraps a stream transport failure as NETWORK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));

    const iterate = async (): Promise<void> => {
      for await (const _chunk of agentsStream(session, "/api/chatv2", { body: {} })) {
        void _chunk;
      }
    };
    await expect(iterate()).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("agentsServerAction", () => {
  it("posts the Next-Action headers and resolves on a 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await agentsServerAction(session, "/schemas/create", {
      actionHash: "abc123",
      routerStateTree: "[tree]",
      args: ["x"],
    });

    const init = fetchMock.mock.calls[0][1] as {
      body: string;
      headers: Record<string, string>;
    };
    expect(init.headers["Next-Action"]).toBe("abc123");
    expect(init.body).toBe('["x"]');
  });

  it("throws AGENTS_API_FAILED with a re-capture hint on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));

    await expect(
      agentsServerAction(session, "/schemas/create", {
        actionHash: "abc123",
        routerStateTree: "[tree]",
        args: [],
      })
    ).rejects.toMatchObject({ code: "AGENTS_API_FAILED" });
  });

  it("wraps a server-action transport failure as NETWORK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")));

    await expect(
      agentsServerAction(session, "/schemas/create", {
        actionHash: "abc123",
        routerStateTree: "[tree]",
        args: [],
      })
    ).rejects.toMatchObject({ code: "NETWORK" });
  });
});
