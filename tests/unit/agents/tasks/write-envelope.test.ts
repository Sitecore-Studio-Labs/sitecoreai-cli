import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAgentsSession = vi.fn();
vi.mock("../../../../src/agents/client", () => ({
  resolveAgentsSession: (...args: unknown[]) => resolveAgentsSession(...args),
}));

import { prepare, writeAgentsEnvelope } from "../../../../src/agents/tasks/shared";

describe("writeAgentsEnvelope", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes a pretty-printed ScaiEnvelope with the agents-prefixed command", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    writeAgentsEnvelope(
      "agent.list",
      { environmentName: "prod" },
      [{ id: "a1" }],
      { count: 1 }
    );

    expect(writes).toHaveLength(1);
    const envelope = JSON.parse(writes[0]);
    expect(envelope.command).toBe("agents.agent.list");
    expect(envelope.environment).toBe("prod");
    expect(envelope.data).toEqual([{ id: "a1" }]);
    expect(envelope.count).toBe(1);
  });

  it("defaults environment to null when no env name is given", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    writeAgentsEnvelope("agent.get", {}, { id: "a1" });

    expect(JSON.parse(writes[0]).environment).toBeNull();
  });
});

describe("prepare", () => {
  beforeEach(() => resolveAgentsSession.mockReset());

  it("builds a logger and resolves the session for the env", async () => {
    const session = { cookie: "abc" };
    resolveAgentsSession.mockResolvedValue({ session, envName: "prod" });

    const result = await prepare({ environmentName: "prod" });

    expect(resolveAgentsSession).toHaveBeenCalledWith({ environmentName: "prod" });
    expect(result.session).toBe(session);
    expect(result.envName).toBe("prod");
    expect(result.logger).toBeDefined();
  });
});
