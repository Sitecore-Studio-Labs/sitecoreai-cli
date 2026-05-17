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
  ensureTelemetryNotice: vi.fn(),
  formatTelemetryCommand: vi.fn().mockReturnValue("scai setup status"),
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
vi.mock("../../../src/config/root-config", () => configMocks);
const keychainMocks = vi.hoisted(() => ({
  getDeployToken: vi.fn(),
}));
vi.mock("../../../src/shared/keychain", () => keychainMocks);
const taskMocks = vi.hoisted(() => ({
  runInit: vi.fn(),
  runDeployToken: vi.fn(),
}));
vi.mock("../../../src/serialization/tasks/env/init", () => ({ runInit: taskMocks.runInit }));
vi.mock("../../../src/serialization/tasks/env/deploy-token", () => ({
  runDeployToken: taskMocks.runDeployToken,
}));

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
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    await import("../../../src/cli");
  });

  it("sets non-interactive mode when flag is present", async () => {
    process.argv = ["node", "scai", "setup", "status", "--non-interactive"];
    vi.resetModules();
    await import("../../../src/cli");
    expect(process.env.SITECOREAI_NON_INTERACTIVE).toBe("1");
  });

  it("sets output flags based on args", async () => {
    process.argv = ["node", "scai", "setup", "status", "--quiet", "--json", "-t"];
    vi.resetModules();
    await import("../../../src/cli");
    expect(process.env.SITECOREAI_QUIET).toBe("1");
    expect(process.env.SITECOREAI_JSON).toBe("1");
    expect(process.env.SITECOREAI_TRACE_HTTP).toBe("1");
  });

  it("sets non-interactive mode when no TTY is available", async () => {
    setTty(false);
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    await import("../../../src/cli");
    expect(process.env.SITECOREAI_NON_INTERACTIVE).toBe("1");
  });

  it("emits JSON errors with exit code on failure", async () => {
    process.argv = ["node", "scai", "setup", "status", "--json"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    actionMock.mockRejectedValueOnce(
      createScaiError("Deploy token not found", "AUTH_REQUIRED", {
        hint: "Run 'scai setup login' to authenticate.",
      })
    );
    await import("../../../src/cli");

    expect(jsonSpy).toHaveBeenCalled();
    const payload = jsonSpy.mock.calls[0][0] as {
      code?: string;
      hint?: string;
      exitCode?: number;
    };
    expect(payload.code).toBe("AUTH_REQUIRED");
    expect(payload.exitCode).toBe(3);
    expect(payload.hint).toBe("Run 'scai setup login' to authenticate.");
  });

  it("emits UNKNOWN code for bare Errors thrown outside ScaiError contract", async () => {
    actionMock.mockRejectedValueOnce(new Error("Some unexpected failure"));
    process.argv = ["node", "scai", "setup", "status", "--json"];
    vi.resetModules();
    await import("../../../src/cli");

    const payload = jsonSpy.mock.calls.at(-1)?.[0] as
      | { code?: string; exitCode?: number; hint?: string }
      | undefined;
    expect(payload?.code).toBe("UNKNOWN");
    expect(payload?.exitCode).toBe(1);
    expect(payload?.hint).toBeUndefined();
  });

  it("prints non-JSON errors with details and hints", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    actionMock.mockRejectedValueOnce(
      createScaiError("Input required", "INPUT_INVALID", {
        hint: "Use --environment-name",
        details: ["Missing configuration"],
      })
    );
    await import("../../../src/cli");

    expect(loggerState.last?.error).toHaveBeenCalledWith("Input required");
    expect(loggerState.last?.verbose).toHaveBeenCalledWith("  - Missing configuration");
    expect(loggerState.last?.warn).toHaveBeenCalledWith("Hint: Use --environment-name");
  });

  it("swallows history and telemetry failures", async () => {
    process.argv = ["node", "scai", "setup", "status"];
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
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError(
        "Couldn't resolve a root configuration file (sitecoreai.cli.json).",
        "CONFIG_NOT_FOUND"
      );
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(configMocks.readRootConfigurationFile).toHaveBeenCalled();
    expect(taskMocks.runInit).toHaveBeenCalledWith(expect.objectContaining({ wizard: true }));
  });

  it("runs init wizard when config is invalid", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError(
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
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError(
        "Couldn't resolve a root configuration file (sitecoreai.cli.json).",
        "CONFIG_NOT_FOUND"
      );
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).toHaveBeenCalledWith(expect.objectContaining({ wizard: true }));
  });

  it("runs login when deploy token is missing", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    keychainMocks.getDeployToken.mockResolvedValue(undefined);
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runDeployToken).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "demo" })
    );
  });

  it("runs login when deploy token is expired", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    // Deploy-token freshness lives on the env profile in the config —
    // an already-expired token there triggers the re-login.
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
    process.argv = ["node", "scai", "setup", "status"];
    setTty(false);
    process.env.SITECOREAI_NON_INTERACTIVE = "1";
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError(
        "Couldn't resolve a root configuration file (sitecoreai.cli.json).",
        "CONFIG_NOT_FOUND"
      );
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).not.toHaveBeenCalled();
    expect(loggerState.last?.warn).toHaveBeenCalled();
  });

  it("sets the verbose env flag for --verbose", async () => {
    process.argv = ["node", "scai", "setup", "status", "--verbose"];
    vi.resetModules();
    await import("../../../src/cli");
    expect(process.env.SITECOREAI_VERBOSE).toBe("1");
  });

  it("sets the verbose env flag for the -v alias", async () => {
    process.argv = ["node", "scai", "setup", "status", "-v"];
    vi.resetModules();
    await import("../../../src/cli");
    expect(process.env.SITECOREAI_VERBOSE).toBe("1");
  });

  it("skips the auto-wizard when SITECOREAI_AUTO_WIZARD is falsy", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    process.env.SITECOREAI_AUTO_WIZARD = "false";
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError("missing", "CONFIG_NOT_FOUND");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The wizard short-circuits before config is even read.
    expect(taskMocks.runInit).not.toHaveBeenCalled();
    expect(configMocks.readRootConfigurationFile).not.toHaveBeenCalled();
  });

  it("skips the auto-wizard for --help", async () => {
    process.argv = ["node", "scai", "setup", "status", "--help"];
    vi.resetModules();
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(configMocks.readRootConfigurationFile).not.toHaveBeenCalled();
  });

  it("skips the auto-wizard for the mcp parent command", async () => {
    // Bare `mcp` (no child, no --help) so the skip is decided by the
    // `parent === "mcp"` branch, not the help branch.
    process.argv = ["node", "scai", "mcp"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError("missing", "CONFIG_NOT_FOUND");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).not.toHaveBeenCalled();
    expect(taskMocks.runDeployToken).not.toHaveBeenCalled();
  });

  it("skips the auto-wizard for the policy parent command", async () => {
    process.argv = ["node", "scai", "policy"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError("missing", "CONFIG_NOT_FOUND");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).not.toHaveBeenCalled();
    expect(taskMocks.runDeployToken).not.toHaveBeenCalled();
  });

  it("skips the auto-wizard for setup init / login / logout / client", async () => {
    for (const child of ["init", "login", "logout", "client"]) {
      process.argv = ["node", "scai", "setup", child];
      vi.resetModules();
      configMocks.readRootConfigurationFile.mockClear();
      await import("../../../src/cli");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(configMocks.readRootConfigurationFile).not.toHaveBeenCalled();
    }
  });

  it("skips the auto-wizard for cli telemetry / config / history", async () => {
    for (const child of ["telemetry", "config", "history"]) {
      process.argv = ["node", "scai", "cli", child];
      vi.resetModules();
      configMocks.readRootConfigurationFile.mockClear();
      await import("../../../src/cli");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(configMocks.readRootConfigurationFile).not.toHaveBeenCalled();
    }
  });

  it("runs the init wizard when the config has zero env profiles", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/tmp/sitecoreai.cli.json",
      rootDir: "/tmp",
      config: { envProfiles: {} },
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).toHaveBeenCalledWith(expect.objectContaining({ wizard: true }));
  });

  it("resolves the env name from --environment-name for the auto-wizard", async () => {
    process.argv = ["node", "scai", "setup", "status", "--environment-name", "staging"];
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/tmp/sitecoreai.cli.json",
      rootDir: "/tmp",
      config: { envProfiles: {} },
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "staging", wizard: true })
    );
  });

  it("resolves the env name from the inline -n=value form", async () => {
    process.argv = ["node", "scai", "setup", "status", "-n=qa"];
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/tmp/sitecoreai.cli.json",
      rootDir: "/tmp",
      config: { envProfiles: {} },
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "qa", wizard: true })
    );
  });

  it("runs init when the resolved env name has no matching profile", async () => {
    process.argv = ["node", "scai", "setup", "status", "--environment-name", "ghost"];
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/tmp/sitecoreai.cli.json",
      rootDir: "/tmp",
      config: { envProfiles: { demo: {} }, defaultEnvProfile: "demo" },
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "ghost" })
    );
  });

  it("auto-selects the sole env profile when no default is configured", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/tmp/sitecoreai.cli.json",
      rootDir: "/tmp",
      config: { envProfiles: { solo: {} } },
    });
    configMocks.readRootConfiguration.mockReturnValue({ environments: { solo: {} } });
    keychainMocks.getDeployToken.mockResolvedValue(undefined);
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runDeployToken).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "solo" })
    );
  });

  it("repairs the config when the resolved profile is CONFIG_INVALID", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfiguration.mockImplementation(() => {
      throw createScaiError("invalid profile", "CONFIG_INVALID");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).toHaveBeenCalledWith(expect.objectContaining({ wizard: true }));
  });

  it("skips the auto-wizard entirely when SITECOREAI_DEPLOY_TOKEN is set", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    process.env.SITECOREAI_DEPLOY_TOKEN = "env-token";
    vi.resetModules();
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Config is read to check profiles, but the keychain is never consulted
    // and neither wizard runs because the env token satisfies auth.
    expect(keychainMocks.getDeployToken).not.toHaveBeenCalled();
    expect(taskMocks.runDeployToken).not.toHaveBeenCalled();
    expect(taskMocks.runInit).not.toHaveBeenCalled();
  });

  it("does not re-login when a fresh deploy token exists", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    configMocks.readRootConfiguration.mockReturnValue({
      environments: {
        demo: {
          deployTokenExpiresIn: 3600,
          deployTokenLastUpdated: new Date().toISOString(),
        },
      },
    });
    keychainMocks.getDeployToken.mockResolvedValue("fresh-token");
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runDeployToken).not.toHaveBeenCalled();
  });

  it("treats a token with unparseable freshness metadata as not expired", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    configMocks.readRootConfiguration.mockReturnValue({
      environments: {
        demo: {
          deployTokenExpiresIn: 3600,
          deployTokenLastUpdated: "not-a-date",
        },
      },
    });
    keychainMocks.getDeployToken.mockResolvedValue("token");
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runDeployToken).not.toHaveBeenCalled();
  });

  it("does NOT skip the auto-wizard for a setup child outside the skip list", async () => {
    // `setup status` is not init/login/logout/client — the wizard must
    // still run, exercising the false arm of the setup-child branch.
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError("missing", "CONFIG_NOT_FOUND");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(configMocks.readRootConfigurationFile).toHaveBeenCalled();
    expect(taskMocks.runInit).toHaveBeenCalledWith(expect.objectContaining({ wizard: true }));
  });

  it("does NOT skip the auto-wizard for a cli child outside the skip list", async () => {
    process.argv = ["node", "scai", "cli", "doctor"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError("missing", "CONFIG_NOT_FOUND");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(configMocks.readRootConfigurationFile).toHaveBeenCalled();
  });

  it("returns null from the auto-wizard when config reads throw a non-config error", async () => {
    // A non-CONFIG_* error from the file reader yields `null` (no need),
    // so neither wizard runs and the command proceeds.
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw new Error("disk exploded");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).not.toHaveBeenCalled();
    expect(taskMocks.runDeployToken).not.toHaveBeenCalled();
  });

  it("returns null when resolving the env profile throws a non-config error", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    configMocks.readRootConfiguration.mockImplementation(() => {
      throw new Error("transient");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).not.toHaveBeenCalled();
    expect(taskMocks.runDeployToken).not.toHaveBeenCalled();
  });

  it("treats a token with zero expiresIn metadata as not expired", async () => {
    process.argv = ["node", "scai", "setup", "status"];
    vi.resetModules();
    configMocks.readRootConfiguration.mockReturnValue({
      environments: {
        demo: { deployTokenExpiresIn: 0, deployTokenLastUpdated: new Date().toISOString() },
      },
    });
    keychainMocks.getDeployToken.mockResolvedValue("token");
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runDeployToken).not.toHaveBeenCalled();
  });

  it("emits a JSON warning when the auto-wizard is needed in --json mode", async () => {
    process.argv = ["node", "scai", "setup", "status", "--json"];
    vi.resetModules();
    const { createScaiError } = await import("../../../src/shared/errors");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw createScaiError("missing", "CONFIG_NOT_FOUND");
    });
    await import("../../../src/cli");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskMocks.runInit).not.toHaveBeenCalled();
    expect(loggerState.last?.warn).toHaveBeenCalledWith(
      expect.stringContaining("Auto-setup skipped")
    );
  });
});
