/**
 * Lazy `McpContext` provider — verifies the memoization shape that lets
 * `scai mcp serve` answer the stdio `initialize` handshake before any
 * keychain access runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedEnvironment } from "../../../src/shared/env";

vi.mock("../../../src/shared/keychain", () => ({
  getDeployToken: vi.fn(),
}));

import { getDeployToken } from "../../../src/shared/keychain";
import { createMcpContextProvider } from "../../../src/mcp/auth";

const mockedGetDeployToken = getDeployToken as unknown as ReturnType<typeof vi.fn>;

const resolved = (token?: string): ResolvedEnvironment =>
  ({
    envName: "test-env",
    environment: { deployToken: token, host: "https://example.test" } as never,
    root: {} as never,
    timeoutMs: undefined,
  }) as ResolvedEnvironment;

describe("createMcpContextProvider", () => {
  beforeEach(() => {
    mockedGetDeployToken.mockReset();
  });
  afterEach(() => {
    mockedGetDeployToken.mockReset();
  });

  it("does not call the keychain until the first invocation", () => {
    createMcpContextProvider(resolved("fallback-token"), "/tmp");
    expect(mockedGetDeployToken).not.toHaveBeenCalled();
  });

  it("caches the resolved context across calls", async () => {
    mockedGetDeployToken.mockResolvedValueOnce("from-keychain");
    const getContext = createMcpContextProvider(resolved(), "/tmp");
    const first = await getContext();
    const second = await getContext();
    expect(first).toBe(second);
    expect(first.deployToken).toBe("from-keychain");
    expect(mockedGetDeployToken).toHaveBeenCalledTimes(1);
  });

  it("shares the in-flight promise across concurrent first callers", async () => {
    let resolve!: (value: string) => void;
    mockedGetDeployToken.mockReturnValueOnce(
      new Promise<string>((res) => {
        resolve = res;
      })
    );
    const getContext = createMcpContextProvider(resolved(), "/tmp");
    const a = getContext();
    const b = getContext();
    const c = getContext();
    resolve("shared-token");
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe(rb);
    expect(rb).toBe(rc);
    expect(mockedGetDeployToken).toHaveBeenCalledTimes(1);
  });

  it("falls back to the env's deployToken when the keychain has nothing", async () => {
    mockedGetDeployToken.mockResolvedValueOnce(undefined);
    const getContext = createMcpContextProvider(resolved("env-fallback"), "/tmp");
    const ctx = await getContext();
    expect(ctx.deployToken).toBe("env-fallback");
  });

  it("does not cache failures and retries the keychain on the next call", async () => {
    mockedGetDeployToken.mockResolvedValueOnce(undefined);
    const getContext = createMcpContextProvider(resolved(), "/tmp");
    await expect(getContext()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    mockedGetDeployToken.mockResolvedValueOnce("recovered");
    const ctx = await getContext();
    expect(ctx.deployToken).toBe("recovered");
    expect(mockedGetDeployToken).toHaveBeenCalledTimes(2);
  });
});
