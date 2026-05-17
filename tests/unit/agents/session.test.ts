import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/agents/session/index.ts` — Agentic Studio session factory +
 * credential lifecycle. The keychain and `playwright-login` are mocked
 * so the orchestration around them (credential parse/validation,
 * AUTH_REQUIRED on a missing session, login persistence, logout) can be
 * exercised without a real OS keychain or browser.
 */
const keychainMocks = vi.hoisted(() => ({
  getAgentsCredential: vi.fn(),
  setAgentsCredential: vi.fn(),
  clearAgentsCredential: vi.fn(),
}));
vi.mock("../../../src/shared/keychain", () => keychainMocks);

const playwrightMocks = vi.hoisted(() => ({ runPlaywrightLogin: vi.fn() }));
vi.mock("../../../src/agents/session/playwright-login", () => playwrightMocks);

import {
  acquireAgentsSession,
  agentsSessionFromCookie,
  createAgentsSession,
  loginAgents,
  logoutAgents,
} from "../../../src/agents/session";

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("falls back to a Chrome User-Agent when the credential has an empty userAgent", () => {
    const session = createAgentsSession({
      kind: "cookie",
      region: "euw",
      cookieHeader: "session=abc",
      userAgent: "",
      capturedAt: "2026-05-16T00:00:00.000Z",
    });
    expect(session.authHeaders()["User-Agent"]).toContain("Mozilla/5.0");
  });

  it("emits a sec-ch-ua-platform brand for the host platform", () => {
    const expected =
      process.platform === "darwin"
        ? '"macOS"'
        : process.platform === "win32"
          ? '"Windows"'
          : '"Linux"';
    const session = createAgentsSession({
      kind: "cookie",
      region: "euw",
      cookieHeader: "s=1",
      userAgent: "UA",
      capturedAt: "2026-05-16T00:00:00.000Z",
    });
    expect(session.authHeaders()["sec-ch-ua-platform"]).toBe(expected);
  });

  it("carries the credential's actionHashes onto the session", () => {
    const session = createAgentsSession({
      kind: "cookie",
      region: "euw",
      cookieHeader: "s=1",
      userAgent: "UA",
      actionHashes: { "/schemas/create": "hash-1" },
      capturedAt: "2026-05-16T00:00:00.000Z",
    });
    expect(session.actionHashes).toEqual({ "/schemas/create": "hash-1" });
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

  it("honours an explicit User-Agent", () => {
    const session = agentsSessionFromCookie({ cookieHeader: "s=1", userAgent: "Custom/9" });
    expect(session.authHeaders()["User-Agent"]).toBe("Custom/9");
  });
});

describe("acquireAgentsSession", () => {
  it("builds a session from a stored cookie credential", async () => {
    keychainMocks.getAgentsCredential.mockResolvedValue(
      JSON.stringify({
        kind: "cookie",
        region: "use",
        cookieHeader: "session=stored",
        userAgent: "StoredUA/2",
        capturedAt: "2026-05-16T00:00:00.000Z",
      })
    );

    const session = await acquireAgentsSession("prod");

    expect(keychainMocks.getAgentsCredential).toHaveBeenCalledWith("prod");
    expect(session.baseUrl).toBe("https://agentic-studio-use.sitecorecloud.io");
    expect(session.authHeaders().Cookie).toBe("session=stored");
  });

  it("defaults region and userAgent when the stored credential omits them", async () => {
    keychainMocks.getAgentsCredential.mockResolvedValue(
      JSON.stringify({ kind: "cookie", cookieHeader: "session=stored" })
    );

    const session = await acquireAgentsSession("prod");

    expect(session.baseUrl).toBe("https://agentic-studio-euw.sitecorecloud.io");
    expect(session.authHeaders()["User-Agent"]).toContain("Mozilla/5.0");
  });

  it("throws AUTH_REQUIRED when no credential is stored", async () => {
    keychainMocks.getAgentsCredential.mockResolvedValue(undefined);

    await expect(acquireAgentsSession("prod")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("throws AUTH_REQUIRED when the stored credential is not valid JSON", async () => {
    keychainMocks.getAgentsCredential.mockResolvedValue("{not json");

    await expect(acquireAgentsSession("prod")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("throws AUTH_REQUIRED when the credential has the wrong kind", async () => {
    keychainMocks.getAgentsCredential.mockResolvedValue(
      JSON.stringify({ kind: "bearer", cookieHeader: "x" })
    );

    await expect(acquireAgentsSession("prod")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("throws AUTH_REQUIRED when the credential has an empty cookieHeader", async () => {
    keychainMocks.getAgentsCredential.mockResolvedValue(
      JSON.stringify({ kind: "cookie", cookieHeader: "" })
    );

    await expect(acquireAgentsSession("prod")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});

describe("loginAgents", () => {
  it("runs the browser login and persists the captured credential to the keychain", async () => {
    const credential = {
      kind: "cookie" as const,
      region: "euw",
      cookieHeader: "session=fresh",
      userAgent: "UA",
      capturedAt: "2026-05-17T00:00:00.000Z",
    };
    playwrightMocks.runPlaywrightLogin.mockResolvedValue(credential);

    const result = await loginAgents({ envName: "prod" });

    expect(playwrightMocks.runPlaywrightLogin).toHaveBeenCalledWith({
      region: "euw",
      timeoutMs: undefined,
    });
    expect(keychainMocks.setAgentsCredential).toHaveBeenCalledWith(
      "prod",
      JSON.stringify(credential)
    );
    expect(result).toEqual({ region: "euw", capturedAt: "2026-05-17T00:00:00.000Z" });
  });

  it("forwards an explicit region and timeout to the browser login", async () => {
    playwrightMocks.runPlaywrightLogin.mockResolvedValue({
      kind: "cookie",
      region: "use",
      cookieHeader: "c",
      userAgent: "UA",
      capturedAt: "2026-05-17T00:00:00.000Z",
    });

    const result = await loginAgents({ envName: "prod", region: "use", timeoutMs: 1000 });

    expect(playwrightMocks.runPlaywrightLogin).toHaveBeenCalledWith({
      region: "use",
      timeoutMs: 1000,
    });
    expect(result.region).toBe("use");
  });
});

describe("logoutAgents", () => {
  it("returns true when the keychain cleared a stored credential", async () => {
    keychainMocks.clearAgentsCredential.mockResolvedValue(true);
    expect(await logoutAgents("prod")).toBe(true);
    expect(keychainMocks.clearAgentsCredential).toHaveBeenCalledWith("prod");
  });

  it("returns false when there was nothing to clear", async () => {
    keychainMocks.clearAgentsCredential.mockResolvedValue(false);
    expect(await logoutAgents("prod")).toBe(false);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
