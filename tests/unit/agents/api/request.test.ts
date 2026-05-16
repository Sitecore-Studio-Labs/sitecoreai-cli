import { afterEach, describe, expect, it, vi } from "vitest";
import { agentsRequest } from "../../../../src/agents/api/request";
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
});
