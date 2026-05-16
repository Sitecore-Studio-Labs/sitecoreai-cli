/**
 * `resolveEnvBinding` — per-call environment resolution for the
 * multi-environment ("Option B") MCP server. Verifies resolution shape,
 * the per-`configPath::envName` memoization, and the missing-token
 * failure contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedEnvironment } from "../../../src/shared/env";

const mocks = vi.hoisted(() => ({
  resolveEnvironment: vi.fn(),
  getDeployToken: vi.fn(),
}));

vi.mock("../../../src/shared/env", () => ({
  resolveEnvironment: mocks.resolveEnvironment,
}));
vi.mock("../../../src/shared/keychain", () => ({
  getDeployToken: mocks.getDeployToken,
}));

import {
  resolveEnvBinding,
  resolveToolBinding,
  __resetEnvBindingCacheForTests,
  type McpContext,
} from "../../../src/mcp/auth";

const resolved = (
  envName: string,
  opts: { allowWrite?: boolean; deployToken?: string } = {}
): ResolvedEnvironment =>
  ({
    envName,
    environment: {
      allowWrite: opts.allowWrite,
      deployToken: opts.deployToken,
    } as never,
    root: { environments: {} } as never,
    timeoutMs: undefined,
  }) as ResolvedEnvironment;

beforeEach(() => {
  __resetEnvBindingCacheForTests();
  mocks.resolveEnvironment.mockReset();
  mocks.getDeployToken.mockReset();
});
afterEach(() => {
  __resetEnvBindingCacheForTests();
});

describe("resolveEnvBinding", () => {
  it("resolves config + deploy token + allowWrite into an EnvBinding", async () => {
    mocks.resolveEnvironment.mockReturnValue(resolved("prod", { allowWrite: true }));
    mocks.getDeployToken.mockResolvedValue("prod-token");

    const binding = await resolveEnvBinding("/cfg", "prod");

    expect(binding.envName).toBe("prod");
    expect(binding.deployToken).toBe("prod-token");
    expect(binding.allowWriteEnabled).toBe(true);
    expect(mocks.resolveEnvironment).toHaveBeenCalledWith({
      config: "/cfg",
      environmentName: "prod",
    });
  });

  it("defaults allowWriteEnabled to false when the env doesn't opt in", async () => {
    mocks.resolveEnvironment.mockReturnValue(resolved("sandbox"));
    mocks.getDeployToken.mockResolvedValue("sandbox-token");

    const binding = await resolveEnvBinding("/cfg", "sandbox");
    expect(binding.allowWriteEnabled).toBe(false);
  });

  it("falls back to the env profile's deployToken when the keychain has nothing", async () => {
    mocks.resolveEnvironment.mockReturnValue(resolved("staging", { deployToken: "from-config" }));
    mocks.getDeployToken.mockResolvedValue(undefined);

    const binding = await resolveEnvBinding("/cfg", "staging");
    expect(binding.deployToken).toBe("from-config");
  });

  it("memoizes per configPath::envName — a repeat call re-uses the binding", async () => {
    mocks.resolveEnvironment.mockReturnValue(resolved("prod"));
    mocks.getDeployToken.mockResolvedValue("prod-token");

    const first = await resolveEnvBinding("/cfg", "prod");
    const second = await resolveEnvBinding("/cfg", "prod");

    expect(first).toBe(second);
    expect(mocks.getDeployToken).toHaveBeenCalledTimes(1);
    expect(mocks.resolveEnvironment).toHaveBeenCalledTimes(1);
  });

  it("does not collide across different envs or config paths", async () => {
    mocks.resolveEnvironment.mockImplementation((opts: { environmentName?: string }) =>
      resolved(opts.environmentName ?? "?")
    );
    mocks.getDeployToken.mockImplementation(async (envName: string) => `${envName}-token`);

    const prod = await resolveEnvBinding("/cfg", "prod");
    const sandbox = await resolveEnvBinding("/cfg", "sandbox");
    const prodOtherConfig = await resolveEnvBinding("/other", "prod");

    expect(prod.deployToken).toBe("prod-token");
    expect(sandbox.deployToken).toBe("sandbox-token");
    expect(prod).not.toBe(prodOtherConfig);
    expect(mocks.getDeployToken).toHaveBeenCalledTimes(3);
  });

  it("shares the in-flight promise across concurrent first callers", async () => {
    mocks.resolveEnvironment.mockReturnValue(resolved("prod"));
    let release!: (token: string) => void;
    mocks.getDeployToken.mockReturnValueOnce(
      new Promise<string>((res) => {
        release = res;
      })
    );

    const a = resolveEnvBinding("/cfg", "prod");
    const b = resolveEnvBinding("/cfg", "prod");
    release("shared-token");
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toBe(rb);
    expect(mocks.getDeployToken).toHaveBeenCalledTimes(1);
  });

  it("throws AUTH_REQUIRED and does not cache the failure when no token is found", async () => {
    mocks.resolveEnvironment.mockReturnValue(resolved("prod"));
    mocks.getDeployToken.mockResolvedValueOnce(undefined);

    await expect(resolveEnvBinding("/cfg", "prod")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });

    // Failure was not cached — the next call retries the keychain.
    mocks.getDeployToken.mockResolvedValueOnce("recovered-token");
    const binding = await resolveEnvBinding("/cfg", "prod");
    expect(binding.deployToken).toBe("recovered-token");
    expect(mocks.getDeployToken).toHaveBeenCalledTimes(2);
  });
});

describe("resolveToolBinding", () => {
  const context: McpContext = {
    envName: "bound-env",
    configPath: "/cfg",
    resolved: resolved("bound-env"),
    allowWriteEnabled: false,
    deployToken: "bound-token",
  };

  it("returns the bound context unchanged when environmentName is omitted", async () => {
    const binding = await resolveToolBinding(context, undefined);
    expect(binding).toBe(context);
    expect(mocks.resolveEnvironment).not.toHaveBeenCalled();
  });

  it("returns the bound context when environmentName equals the bound env", async () => {
    const binding = await resolveToolBinding(context, "bound-env");
    expect(binding).toBe(context);
    expect(mocks.resolveEnvironment).not.toHaveBeenCalled();
  });

  it("resolves a different environment when environmentName is set", async () => {
    mocks.resolveEnvironment.mockReturnValue(resolved("other-env", { allowWrite: true }));
    mocks.getDeployToken.mockResolvedValue("other-token");

    const binding = await resolveToolBinding(context, "other-env");
    expect(binding).not.toBe(context);
    expect(binding.envName).toBe("other-env");
    expect(binding.deployToken).toBe("other-token");
    expect(binding.allowWriteEnabled).toBe(true);
  });
});
