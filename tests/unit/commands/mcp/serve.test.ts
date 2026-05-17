import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai mcp serve` command wiring. Every MCP subsystem the handler
 * touches (logging discipline, env resolution, registry build, the
 * stdio/http transports) and the policy enroll are mocked; tests parse
 * the commander command tree to assert option parsing (the --port
 * validator, defaults, transport choices) and drive `runMcpServe` to
 * assert transport selection, the loopback-host warning, and the
 * fail-fast error path.
 */

const loggingMocks = vi.hoisted(() => ({
  installMcpStdoutDiscipline: vi.fn(),
  writeStartupLine: vi.fn(),
}));

vi.mock("../../../../src/mcp/logging", () => loggingMocks);

const authMocks = vi.hoisted(() => ({
  createMcpContextProvider: vi.fn(),
  resolveMcpEnv: vi.fn(),
}));

vi.mock("../../../../src/mcp/auth", () => authMocks);

const registryMocks = vi.hoisted(() => ({
  buildScaiMcpRegistry: vi.fn(() => ({ tools: [] })),
}));

vi.mock("../../../../src/mcp/build-registry", () => registryMocks);

const serverMocks = vi.hoisted(() => ({
  buildMcpServer: vi.fn(() => ({ kind: "server" })),
  startStdioTransport: vi.fn(),
}));

vi.mock("../../../../src/mcp/server", () => serverMocks);

const httpMocks = vi.hoisted(() => ({
  startHttpTransport: vi.fn(),
}));

vi.mock("../../../../src/mcp/http", () => httpMocks);

const policyMocks = vi.hoisted(() => ({
  enrollEnvironment: vi.fn(),
}));

vi.mock("../../../../src/policy", () => policyMocks);

import { createMcpServeCommand, runMcpServe } from "../../../../src/commands/mcp/serve";

const resolvedEnv = {
  envName: "agents",
  environment: { organizationId: "org_A", name: "agents" },
};

let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const group of [
    loggingMocks,
    authMocks,
    registryMocks,
    serverMocks,
    httpMocks,
    policyMocks,
  ]) {
    for (const m of Object.values(group)) {
      if (typeof m === "function" && "mockReset" in m) m.mockReset();
    }
  }
  registryMocks.buildScaiMcpRegistry.mockReturnValue({ tools: [] });
  serverMocks.buildMcpServer.mockReturnValue({ kind: "server" });
  authMocks.resolveMcpEnv.mockReturnValue(resolvedEnv);
  authMocks.createMcpContextProvider.mockReturnValue(vi.fn().mockResolvedValue({}));
  serverMocks.startStdioTransport.mockResolvedValue(undefined);
  httpMocks.startHttpTransport.mockResolvedValue({
    url: "http://127.0.0.1:3399/mcp",
    close: vi.fn().mockResolvedValue(undefined),
  });
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("createMcpServeCommand — option parsing", () => {
  const longs = (): Set<string> => {
    const command = createMcpServeCommand();
    return new Set(command.options.map((o) => o.long).filter((l): l is string => Boolean(l)));
  };

  it("declares the transport / port / host / config options", () => {
    const opts = longs();
    for (const flag of ["--transport", "--port", "--host", "--config", "--environment-name"]) {
      expect(opts.has(flag)).toBe(true);
    }
  });

  it("defaults transport to stdio, port to 3399, host to loopback", () => {
    const command = createMcpServeCommand();
    const parsed = command.exitOverride().parse(["node", "scai", "serve"], { from: "user" }).opts();
    expect(parsed.transport).toBe("stdio");
    expect(parsed.port).toBe(3399);
    expect(parsed.host).toBe("127.0.0.1");
  });

  it("rejects a non-numeric --port via the argParser", () => {
    const command = createMcpServeCommand().exitOverride();
    expect(() =>
      command.parse(["node", "scai", "serve", "--port", "abc"], { from: "user" })
    ).toThrow(/integer between 1 and 65535/);
  });

  it("rejects an out-of-range --port", () => {
    const command = createMcpServeCommand().exitOverride();
    expect(() =>
      command.parse(["node", "scai", "serve", "--port", "70000"], { from: "user" })
    ).toThrow(/integer between 1 and 65535/);
  });

  it("rejects an unknown --transport choice", () => {
    const command = createMcpServeCommand().exitOverride();
    expect(() =>
      command.parse(["node", "scai", "serve", "--transport", "grpc"], { from: "user" })
    ).toThrow();
  });
});

describe("runMcpServe — stdio transport", () => {
  it("installs stdout discipline, enrolls the env, and starts the stdio transport", async () => {
    await runMcpServe({ transport: "stdio" });
    expect(loggingMocks.installMcpStdoutDiscipline).toHaveBeenCalledOnce();
    expect(policyMocks.enrollEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ envName: "agents", via: "mcp-serve" })
    );
    expect(serverMocks.startStdioTransport).toHaveBeenCalledWith({ kind: "server" });
    expect(httpMocks.startHttpTransport).not.toHaveBeenCalled();
  });

  it("survives a policy enroll failure and still starts the server", async () => {
    policyMocks.enrollEnvironment.mockImplementation(() => {
      throw new Error("policy write failed");
    });
    await runMcpServe({ transport: "stdio" });
    expect(serverMocks.startStdioTransport).toHaveBeenCalledOnce();
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(
      /could not update the workspace policy/
    );
  });
});

describe("runMcpServe — http transport", () => {
  it("starts the HTTP transport on the given host and port", async () => {
    await runMcpServe({ transport: "http", host: "127.0.0.1", port: 4000 });
    expect(httpMocks.startHttpTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "127.0.0.1", port: 4000 })
    );
    expect(serverMocks.startStdioTransport).not.toHaveBeenCalled();
  });

  it("warns when binding to a non-loopback host", async () => {
    await runMcpServe({ transport: "http", host: "0.0.0.0" });
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/non-loopback host/);
  });

  it("does not warn for a loopback host", async () => {
    await runMcpServe({ transport: "http", host: "localhost" });
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).not.toMatch(/non-loopback/);
  });
});

describe("runMcpServe — fail-fast error path", () => {
  it("sets process.exitCode and writes the error when env resolution throws", async () => {
    authMocks.resolveMcpEnv.mockImplementation(() => {
      throw new Error("bad config");
    });
    await runMcpServe({ transport: "stdio" });
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(
      /scai mcp serve failed: bad config/
    );
    expect(process.exitCode).toBeTypeOf("number");
    expect(serverMocks.startStdioTransport).not.toHaveBeenCalled();
  });
});
