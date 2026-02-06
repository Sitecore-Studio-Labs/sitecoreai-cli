import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const actionMock = vi.fn(async () => undefined);
const makeCommand = (name: string): Command =>
  new Command(name)
    .option("--json")
    .option("--non-interactive")
    .option("-q, --quiet")
    .option("-t, --trace")
    .action(actionMock);

const jsonSpy = vi.fn();
const loggerState: {
  last?: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    verbose: ReturnType<typeof vi.fn>;
  };
} = {};
vi.mock("../../../src/shared/logger", () => ({
  Logger: class {
    private readonly jsonEnabled: boolean;
    constructor(_verbose: boolean, _trace: boolean, jsonEnabled: boolean) {
      this.jsonEnabled = jsonEnabled;
      loggerState.last = this;
    }
    isJson(): boolean {
      return this.jsonEnabled;
    }
    json = jsonSpy;
    info = vi.fn();
    error = vi.fn();
    warn = vi.fn();
    verbose = vi.fn();
  },
}));

vi.mock("../../../src/commands/status", () => ({
  createStatusCommand: () => makeCommand("status"),
}));
vi.mock("../../../src/commands/login", () => ({
  createLoginCommand: () => makeCommand("login"),
}));
vi.mock("../../../src/commands/logout", () => ({
  createLogoutCommand: () => makeCommand("logout"),
}));
vi.mock("../../../src/commands/init", () => ({
  createInitCommand: () => makeCommand("init"),
}));
vi.mock("../../../src/commands/serialization", () => ({
  createSerializationCommand: () => makeCommand("serialization"),
}));
vi.mock("../../../src/commands/deploy", () => ({
  createDeployCommand: () => makeCommand("deploy"),
}));
vi.mock("../../../src/commands/history", () => ({
  createHistoryCommand: () => makeCommand("history"),
}));
vi.mock("../../../src/commands/config", () => ({
  createConfigCommand: () => makeCommand("config"),
}));
vi.mock("../../../src/commands/telemetry", () => ({
  createTelemetryCommand: () => makeCommand("telemetry"),
}));
vi.mock("../../../src/shared/history", () => ({
  ensureHistoryFile: vi.fn(),
  recordHistory: vi.fn(),
}));
vi.mock("../../../src/shared/telemetry", () => ({
  ensureTelemetryConsent: vi.fn(),
  formatTelemetryCommand: vi.fn().mockReturnValue("scai status"),
  recordTelemetry: vi.fn(),
  resolveConfigPathFromArgs: vi.fn().mockReturnValue(undefined),
  setTelemetryVersion: vi.fn(),
}));
vi.mock("../../../src/shared/style", () => ({
  showBanner: vi.fn(),
}));
const configMocks = vi.hoisted(() => ({
  readRootConfigurationFile: vi.fn(),
  readRootConfiguration: vi.fn(),
}));
vi.mock("../../../src/config", () => configMocks);
const keychainMocks = vi.hoisted(() => ({
  getDeployToken: vi.fn(),
}));
vi.mock("../../../src/shared/keychain", () => keychainMocks);
const taskMocks = vi.hoisted(() => ({
  runInit: vi.fn(),
  runDeployToken: vi.fn(),
}));
vi.mock("../../../src/serialization/tasks", () => taskMocks);

describe("cli entrypoint", () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  const originalStdinTty = process.stdin.isTTY;
  const originalStdoutTty = process.stdout.isTTY;

  const setTty = (value: boolean): void => {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  };

  beforeEach(() => {
    actionMock.mockResolvedValue(undefined);
    jsonSpy.mockClear();
    loggerState.last = undefined;
    process.env = { ...originalEnv };
    delete process.env.SITECOREAI_AUTO_WIZARD;
    delete process.env.SITECOREAI_NON_INTERACTIVE;
    process.env.SITECOREAI_AUTO_WIZARD = "1";
    setTty(true);
    configMocks.readRootConfigurationFile.mockClear();
    configMocks.readRootConfiguration.mockClear();
    keychainMocks.getDeployToken.mockClear();
    taskMocks.runInit.mockClear();
    taskMocks.runDeployToken.mockClear();
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/tmp/sitecoreai.cli.json",
      rootDir: "/tmp",
      config: { envProfiles: { demo: {} }, defaultEnvProfile: "demo" },
    });
    configMocks.readRootConfiguration.mockReturnValue({
      environments: { demo: {} },
    });
    keychainMocks.getDeployToken.mockResolvedValue("token");
    taskMocks.runInit.mockResolvedValue(undefined);
    taskMocks.runDeployToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinTty,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutTty,
      configurable: true,
    });
  });

  it("runs with a basic command", async () => {
    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    await import("../../../src/cli");
  });

  it("sets non-interactive mode when flag is present", async () => {
    process.argv = ["node", "scai", "status", "--non-interactive"];
    vi.resetModules();
    await import("../../../src/cli");
    expect(process.env.SITECOREAI_NON_INTERACTIVE).toBe("1");
  });

  it("sets output flags based on args", async () => {
    process.argv = ["node", "scai", "status", "--quiet", "--json", "-t"];
    vi.resetModules();
    await import("../../../src/cli");
    expect(process.env.SITECOREAI_QUIET).toBe("1");
    expect(process.env.SITECOREAI_JSON).toBe("1");
    expect(process.env.SITECOREAI_TRACE_HTTP).toBe("1");
  });

  it("sets non-interactive mode when no TTY is available", async () => {
    setTty(false);
    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    await import("../../../src/cli");
    expect(process.env.SITECOREAI_NON_INTERACTIVE).toBe("1");
  });

  it("emits JSON errors with exit code on failure", async () => {
    actionMock.mockRejectedValueOnce(new Error("Deploy token not found"));
    process.argv = ["node", "scai", "status", "--json"];
    vi.resetModules();
    await import("../../../src/cli");

    expect(jsonSpy).toHaveBeenCalled();
    const payload = jsonSpy.mock.calls[0][0] as {
      code?: string;
      hint?: string;
      exitCode?: number;
    };
    expect(payload.code).toBe("AUTH_REQUIRED");
    expect(payload.exitCode).toBe(3);
    expect(payload.hint).toBe("Run 'scai init' or 'scai login' to authenticate.");
  });

  it("uses a guessed hint for deploy access token errors", async () => {
    actionMock.mockRejectedValueOnce(new Error("Deploy API access token is required"));
    process.argv = ["node", "scai", "status", "--json"];
    vi.resetModules();
    await import("../../../src/cli");

    const payload = jsonSpy.mock.calls.at(-1)?.[0] as { hint?: string } | undefined;
    expect(payload?.hint).toBe("Provide --deploy-token or run 'scai login' to authenticate.");
  });

  it("prints non-JSON errors with details and hints", async () => {
    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    const { createCliError } = await import("../../../src/shared/errors");
    actionMock.mockRejectedValueOnce(
      createCliError("Input required", "INPUT_INVALID", {
        hint: "Use --environment-name",
        details: ["Missing configuration"],
      })
    );
    await import("../../../src/cli");

    expect(loggerState.last?.error).toHaveBeenCalledWith("Input required");
    expect(loggerState.last?.verbose).toHaveBeenCalledWith("  - Missing configuration");
    expect(loggerState.last?.warn).toHaveBeenCalledWith("Hint: Use --environment-name");
  });

  it.each([
    [
      "Project ID is required",
      "Provide --project/--id or set projectId in the environment profile.",
    ],
    [
      "Environment ID is required",
      "Provide --id/--name or set environmentId in the environment profile.",
    ],
    [
      "Environment name is required",
      "Provide --environment-name or set defaultEnvProfile in the config.",
    ],
    [
      "Client ID and client secret are required",
      "Provide --client-id/--client-secret or set SITECOREAI_CLIENT_ID/SECRET.",
    ],
    ["Client ID is required", "Provide --client-id or set SITECOREAI_CLIENT_ID."],
    ["Environment host is not configured", "Set a CM host with 'scai init' or pass --host."],
    [
      "configuration file could not be resolved",
      "Run 'scai init' to create a config or fix the config file.",
    ],
  ])("guesses hint for %s", async (message, expected) => {
    actionMock.mockRejectedValueOnce(new Error(message));
    process.argv = ["node", "scai", "status", "--json"];
    vi.resetModules();
    await import("../../../src/cli");

    const payload = jsonSpy.mock.calls.at(-1)?.[0] as { hint?: string } | undefined;
    expect(payload?.hint).toBe(expected);
  });

  it("swallows history and telemetry failures", async () => {
    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    const history = await import("../../../src/shared/history");
    const telemetry = await import("../../../src/shared/telemetry");

    (
      history.ensureHistoryFile as unknown as {
        mockRejectedValueOnce: (value: unknown) => void;
      }
    ).mockRejectedValueOnce(new Error("history"));
    const recordHistoryMock = history.recordHistory as unknown as {
      mockRejectedValueOnce: (value: unknown) => void;
      mockResolvedValueOnce: (value: unknown) => void;
    };
    recordHistoryMock.mockRejectedValueOnce(new Error("history"));
    recordHistoryMock.mockResolvedValueOnce(undefined);

    const recordTelemetryMock = telemetry.recordTelemetry as unknown as {
      mockRejectedValueOnce: (value: unknown) => void;
      mockResolvedValueOnce: (value: unknown) => void;
    };
    recordTelemetryMock.mockRejectedValueOnce(new Error("telemetry"));
    recordTelemetryMock.mockResolvedValueOnce(undefined);

    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(history.ensureHistoryFile).toHaveBeenCalled();
    expect(history.recordHistory).toHaveBeenCalled();
    expect(telemetry.recordTelemetry).toHaveBeenCalled();
  });

  it("runs init wizard when config is missing", async () => {
    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw new Error("Couldn't resolve a root configuration file (sitecoreai.cli.json).");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(configMocks.readRootConfigurationFile).toHaveBeenCalled();
    expect(taskMocks.runInit).toHaveBeenCalledWith(expect.objectContaining({ wizard: true }));
  });

  it("runs init wizard when config is invalid", async () => {
    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    const { createCliError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createCliError(
        "Invalid configuration file at /tmp/sitecoreai.cli.json.",
        "CONFIG_INVALID"
      );
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).toHaveBeenCalledWith(expect.objectContaining({ wizard: true }));
  });

  it("runs init wizard when no command is provided", async () => {
    process.argv = ["node", "scai"];
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw new Error("Couldn't resolve a root configuration file (sitecoreai.cli.json).");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).toHaveBeenCalledWith(expect.objectContaining({ wizard: true }));
  });

  it("runs login when deploy token is missing", async () => {
    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    keychainMocks.getDeployToken.mockResolvedValue(undefined);
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runDeployToken).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "demo" })
    );
  });

  it("runs login when deploy token is expired", async () => {
    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    configMocks.readRootConfiguration.mockReturnValue({
      environments: {
        demo: {
          deployTokenExpiresIn: 1,
          deployTokenLastUpdated: new Date(Date.now() - 2_000).toISOString(),
        },
      },
    });
    keychainMocks.getDeployToken.mockResolvedValue("token");
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runDeployToken).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "demo" })
    );
  });

  it("skips auto-wizard in non-interactive mode", async () => {
    process.argv = ["node", "scai", "status"];
    setTty(false);
    process.env.SITECOREAI_NON_INTERACTIVE = "1";
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw new Error("Couldn't resolve a root configuration file (sitecoreai.cli.json).");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).not.toHaveBeenCalled();
    expect(loggerState.last?.warn).toHaveBeenCalled();
  });
});
