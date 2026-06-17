import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";

/**
 * `runAgentsLogin / runAgentsLogout / runAgentsStatus` orchestration
 * coverage. The env resolution, region resolution, token mint, browser
 * login, keychain logout, and `/api/token-refresh` probe are all mocked
 * so this exercises only the runners' branches — explicit-region vs
 * resolved-region, json vs human output, cleared vs not-cleared logout,
 * and valid vs invalid session status.
 */

const envMocks = vi.hoisted(() => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: envMocks.resolveEnvironment,
}));

const regionMocks = vi.hoisted(() => ({ resolveRegionCode: vi.fn() }));
vi.mock("../../../../src/shared/region", () => ({
  resolveRegionCode: regionMocks.resolveRegionCode,
}));

const authMocks = vi.hoisted(() => ({ requestClientCredentialsToken: vi.fn() }));
vi.mock("../../../../src/auth/client-credentials", () => ({
  requestClientCredentialsToken: authMocks.requestClientCredentialsToken,
}));

const sessionMocks = vi.hoisted(() => ({ loginAgents: vi.fn(), logoutAgents: vi.fn() }));
vi.mock("../../../../src/agents/session", () => ({
  loginAgents: sessionMocks.loginAgents,
  logoutAgents: sessionMocks.logoutAgents,
}));

const requestMocks = vi.hoisted(() => ({ agentsRequest: vi.fn() }));
vi.mock("../../../../src/agents/api/request", () => ({
  agentsRequest: requestMocks.agentsRequest,
}));

vi.mock("../../../../src/agents/tasks/shared", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/agents/tasks/shared")>(
    "../../../../src/agents/tasks/shared"
  );
  return { ...actual, prepare: vi.fn() };
});

import {
  runAgentsLogin,
  runAgentsLogout,
  runAgentsStatus,
} from "../../../../src/agents/tasks/session";
import { prepare } from "../../../../src/agents/tasks/shared";
import { Logger } from "../../../../src/shared/logger";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

let stdout: ReturnType<typeof vi.spyOn>;
let consolaInfo: ReturnType<typeof vi.spyOn>;

const jsonOut = (): unknown => {
  const raw = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null"));
  if (raw && typeof raw === "object" && "data" in raw) return (raw as { data: unknown }).data;
  return raw;
};
const humanLines = (): string[] => consolaInfo.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  consolaInfo = vi.spyOn(consola, "info").mockReturnValue(undefined as never);
  envMocks.resolveEnvironment.mockReturnValue({
    envName: "test",
    environment: { organizationId: "org-1" },
  });
});

afterEach(() => {
  stdout.mockRestore();
  consolaInfo.mockRestore();
});

describe("runAgentsLogin", () => {
  it("uses an explicit --region without resolving it from the org id", async () => {
    sessionMocks.loginAgents.mockResolvedValue({
      region: "use",
      capturedAt: "2026-05-17T00:00:00.000Z",
    });

    await runAgentsLogin({ region: "use" } as never);

    expect(regionMocks.resolveRegionCode).not.toHaveBeenCalled();
    expect(sessionMocks.loginAgents).toHaveBeenCalledWith({ envName: "test", region: "use" });
  });

  it("resolves the region from the org id when --region is omitted", async () => {
    regionMocks.resolveRegionCode.mockResolvedValue("euw");
    sessionMocks.loginAgents.mockResolvedValue({
      region: "euw",
      capturedAt: "2026-05-17T00:00:00.000Z",
    });

    await runAgentsLogin({} as never);

    expect(regionMocks.resolveRegionCode).toHaveBeenCalledOnce();
    expect(sessionMocks.loginAgents).toHaveBeenCalledWith({ envName: "test", region: "euw" });
  });

  it("threads a minted access token into the region resolver's acquireToken callback", async () => {
    authMocks.requestClientCredentialsToken.mockResolvedValue({ accessToken: "tok-9" });
    regionMocks.resolveRegionCode.mockImplementation(
      async (opts: { acquireToken: () => Promise<string | undefined> }) => {
        const token = await opts.acquireToken();
        expect(token).toBe("tok-9");
        return "euw";
      }
    );
    sessionMocks.loginAgents.mockResolvedValue({
      region: "euw",
      capturedAt: "2026-05-17T00:00:00.000Z",
    });

    await runAgentsLogin({} as never);

    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledOnce();
  });

  it("emits a JSON envelope in --json mode", async () => {
    sessionMocks.loginAgents.mockResolvedValue({
      region: "use",
      capturedAt: "2026-05-17T00:00:00.000Z",
    });

    await runAgentsLogin({ region: "use", json: true } as never);

    expect(jsonOut()).toMatchObject({ ok: true, envName: "test", region: "use" });
  });

  it("prints a human confirmation line in non-json mode", async () => {
    sessionMocks.loginAgents.mockResolvedValue({
      region: "use",
      capturedAt: "2026-05-17T00:00:00.000Z",
    });

    await runAgentsLogin({ region: "use" } as never);

    expect(humanLines().some((l) => l.includes("session captured"))).toBe(true);
  });
});

describe("runAgentsLogout", () => {
  it("reports ok:true in JSON mode when a session was cleared", async () => {
    sessionMocks.logoutAgents.mockResolvedValue(true);

    await runAgentsLogout({ json: true } as never);

    expect(jsonOut()).toMatchObject({ ok: true, envName: "test" });
  });

  it("reports ok:false in JSON mode when nothing was stored", async () => {
    sessionMocks.logoutAgents.mockResolvedValue(false);

    await runAgentsLogout({ json: true } as never);

    expect(jsonOut()).toMatchObject({ ok: false, envName: "test" });
  });

  it("prints the cleared line in human mode when a session existed", async () => {
    sessionMocks.logoutAgents.mockResolvedValue(true);

    await runAgentsLogout({} as never);

    expect(humanLines().some((l) => l.includes("Cleared the Agentic Studio session"))).toBe(true);
  });

  it("prints the no-session line in human mode when nothing was stored", async () => {
    sessionMocks.logoutAgents.mockResolvedValue(false);

    await runAgentsLogout({} as never);

    expect(humanLines().some((l) => l.includes("No Agentic Studio session was stored"))).toBe(true);
  });
});

describe("runAgentsStatus", () => {
  const usePrepare = (json: boolean): void => {
    vi.mocked(prepare).mockResolvedValue({
      logger: new Logger(false, false, json, false),
      session: SESSION,
      envName: "test",
    } as never);
  };

  it("reports valid:true when /api/token-refresh does not return success:false", async () => {
    usePrepare(true);
    requestMocks.agentsRequest.mockResolvedValue({
      success: true,
      expiresAt: "2026-06-01T00:00:00.000Z",
    });

    await runAgentsStatus({} as never);

    expect(jsonOut()).toMatchObject({
      envName: "test",
      valid: true,
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("reports valid:false when the refresh probe returns success:false", async () => {
    usePrepare(true);
    requestMocks.agentsRequest.mockResolvedValue({ success: false });

    await runAgentsStatus({} as never);

    expect(jsonOut()).toMatchObject({ envName: "test", valid: false });
  });

  it("treats an undefined refresh body as a valid session", async () => {
    usePrepare(true);
    requestMocks.agentsRequest.mockResolvedValue(undefined);

    await runAgentsStatus({} as never);

    expect(jsonOut()).toMatchObject({ valid: true });
  });

  it("renders the endpoint and a valid session line in human mode", async () => {
    usePrepare(false);
    requestMocks.agentsRequest.mockResolvedValue({ success: true });

    await runAgentsStatus({} as never);

    const lines = humanLines();
    expect(lines.some((l) => l.includes(SESSION.baseUrl))).toBe(true);
    expect(lines.some((l) => l.includes("valid"))).toBe(true);
  });

  it("renders an invalid session line in human mode and omits expiry when absent", async () => {
    usePrepare(false);
    requestMocks.agentsRequest.mockResolvedValue({ success: false });

    await runAgentsStatus({} as never);

    const lines = humanLines();
    expect(lines.some((l) => l.includes("invalid"))).toBe(true);
    expect(lines.some((l) => l.includes("Token expires"))).toBe(false);
  });

  it("prints the token-expiry line in human mode when expiresAt is present", async () => {
    usePrepare(false);
    requestMocks.agentsRequest.mockResolvedValue({
      success: true,
      expiresAt: "2026-06-01T00:00:00.000Z",
    });

    await runAgentsStatus({} as never);

    expect(humanLines().some((l) => l.includes("Token expires"))).toBe(true);
  });
});
