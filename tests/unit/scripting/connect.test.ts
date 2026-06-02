import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for `connect()` — the public scripting entry point.
 *
 * Branches:
 *  1. options.configPath set vs omitted (passed-through to resolveEnvironment)
 *  2. options.envName set vs omitted (same)
 *  3. timeoutMs present vs undefined (request shape differs)
 */

const policyMocks = vi.hoisted(() => ({
  resolveEnvironment: vi.fn(),
}));
const apiMocks = vi.hoisted(() => ({
  createHygieneApiClient: vi.fn(),
}));

vi.mock("../../../src/policy/environment", () => policyMocks);
vi.mock("../../../src/hygiene/api/client", () => apiMocks);

import { connect } from "../../../src/scripting/connect";

const fakeClient = { id: "client-1" };
const baseResolved = {
  envName: "sandbox",
  environment: { host: "https://example/" },
};

beforeEach(() => {
  policyMocks.resolveEnvironment.mockReset();
  apiMocks.createHygieneApiClient.mockReset().mockReturnValue(fakeClient);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connect", () => {
  it("delegates env resolution with both options when set, threading timeoutMs into the request", () => {
    policyMocks.resolveEnvironment.mockReturnValue({ ...baseResolved, timeoutMs: 30_000 });
    const client = connect({ envName: "staging", configPath: "/tmp/cfg" });
    expect(policyMocks.resolveEnvironment).toHaveBeenCalledWith({
      config: "/tmp/cfg",
      environmentName: "staging",
    });
    expect(apiMocks.createHygieneApiClient).toHaveBeenCalledWith({
      environment: baseResolved.environment,
      request: { timeoutMs: 30_000 },
    });
    expect(client.envName).toBe("sandbox");
    expect(client.hygiene).toBe(fakeClient);
  });

  it("passes undefined config + env when called with no args (defaults branch)", () => {
    policyMocks.resolveEnvironment.mockReturnValue({ ...baseResolved, timeoutMs: undefined });
    connect();
    expect(policyMocks.resolveEnvironment).toHaveBeenCalledWith({
      config: undefined,
      environmentName: undefined,
    });
    // request stays undefined when timeoutMs is absent (no shim object built).
    expect(apiMocks.createHygieneApiClient).toHaveBeenCalledWith({
      environment: baseResolved.environment,
      request: undefined,
    });
  });

  it("omits request entirely when timeoutMs is 0 / falsy (truthiness branch)", () => {
    policyMocks.resolveEnvironment.mockReturnValue({ ...baseResolved, timeoutMs: 0 });
    connect();
    expect(apiMocks.createHygieneApiClient).toHaveBeenCalledWith({
      environment: baseResolved.environment,
      request: undefined,
    });
  });
});
