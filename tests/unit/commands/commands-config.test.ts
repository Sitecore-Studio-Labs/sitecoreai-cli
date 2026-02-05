import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigCommand } from "../../../src/commands/config";

const configMocks = vi.hoisted(() => ({
  readRootConfigurationFile: vi.fn(),
}));

vi.mock("../../../src/config", () => configMocks);

const loggerState: {
  last?: { json: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
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
    json = vi.fn();
    info = vi.fn();
  },
}));

describe("config command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loggerState.last = undefined;
  });

  it("prints JSON output for validate", async () => {
    configMocks.readRootConfigurationFile.mockReturnValue({ rootPath: "/config/root" });
    const command = createConfigCommand();

    await command.parseAsync(["node", "scai", "validate", "--config", "/config", "--json"]);

    expect(configMocks.readRootConfigurationFile).toHaveBeenCalledWith("/config");
    expect(loggerState.last?.json).toHaveBeenCalledWith({
      valid: true,
      path: "/config/root",
    });
  });

  it("prints text output for validate", async () => {
    configMocks.readRootConfigurationFile.mockReturnValue({ rootPath: "/config/root" });
    const command = createConfigCommand();

    await command.parseAsync(["node", "scai", "validate", "--config", "/config"]);

    expect(loggerState.last?.info).toHaveBeenCalledWith("Config valid: /config/root", "green");
  });
});
