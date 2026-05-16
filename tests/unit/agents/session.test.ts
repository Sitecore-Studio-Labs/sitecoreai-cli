import { describe, expect, it } from "vitest";
import { agentsSessionFromCookie, createAgentsSession } from "../../../src/agents/session";

describe("createAgentsSession", () => {
  it("derives the regional base URL and cookie + browser auth headers", () => {
    const session = createAgentsSession({
      kind: "cookie",
      region: "euw",
      cookieHeader: "session=abc",
      userAgent: "TestUA/1.0",
      capturedAt: "2026-05-16T00:00:00.000Z",
    });
    expect(session.baseUrl).toBe("https://agentic-studio-euw.sitecorecloud.io");
    const headers = session.authHeaders();
    expect(headers.Cookie).toBe("session=abc");
    expect(headers["User-Agent"]).toBe("TestUA/1.0");
    expect(headers["sec-fetch-site"]).toBe("same-origin");
  });
});

describe("agentsSessionFromCookie", () => {
  it("builds a session from a bare cookie, defaulting region and User-Agent", () => {
    const session = agentsSessionFromCookie({ cookieHeader: "session=xyz" });
    expect(session.baseUrl).toBe("https://agentic-studio-euw.sitecorecloud.io");
    expect(session.authHeaders().Cookie).toBe("session=xyz");
    expect(session.authHeaders()["User-Agent"]).toBeTruthy();
  });

  it("honours an explicit region", () => {
    const session = agentsSessionFromCookie({ cookieHeader: "s=1", region: "use" });
    expect(session.baseUrl).toBe("https://agentic-studio-use.sitecorecloud.io");
  });
});
