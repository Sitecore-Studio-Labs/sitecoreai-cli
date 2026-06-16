import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEnvironment = vi.fn();
const acquireAgentsSession = vi.fn();

vi.mock("../../../src/policy/environment", () => ({
  resolveEnvironment: (...args: unknown[]) => resolveEnvironment(...args),
}));
vi.mock("../../../src/agents/session", () => ({
  acquireAgentsSession: (...args: unknown[]) => acquireAgentsSession(...args),
}));

import { resolveAgentsSession } from "../../../src/agents/client";

describe("resolveAgentsSession", () => {
  beforeEach(() => {
    resolveEnvironment.mockReset();
    acquireAgentsSession.mockReset();
  });

  it("resolves the env profile, loads its session, and returns both", async () => {
    resolveEnvironment.mockReturnValue({ envName: "prod" });
    const session = { cookie: "abc", baseUrl: "https://example" };
    acquireAgentsSession.mockResolvedValue(session);

    const result = await resolveAgentsSession({
      environmentName: "prod",
      config: "/cfg",
    });

    expect(resolveEnvironment).toHaveBeenCalledWith({
      environmentName: "prod",
      config: "/cfg",
    });
    expect(acquireAgentsSession).toHaveBeenCalledWith("prod");
    expect(result).toEqual({ session, envName: "prod" });
  });

  it("defaults options to an empty object", async () => {
    resolveEnvironment.mockReturnValue({ envName: "default-env" });
    acquireAgentsSession.mockResolvedValue({ cookie: "x" });

    const result = await resolveAgentsSession();

    expect(resolveEnvironment).toHaveBeenCalledWith({});
    expect(result.envName).toBe("default-env");
  });
});
