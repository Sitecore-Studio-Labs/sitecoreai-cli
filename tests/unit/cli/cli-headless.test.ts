import { describe, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const makeCommand = (name: string): Command => new Command(name).action(async () => undefined);

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
vi.mock("../../../src/shared/telemetry", async () => {
  const actual = await vi.importActual<typeof import("../../../src/shared/telemetry")>(
    "../../../src/shared/telemetry"
  );
  return {
    ...actual,
    recordTelemetry: vi.fn(),
    setTelemetryVersion: vi.fn(),
    resolveConfigPathFromArgs: vi.fn().mockReturnValue(undefined),
    formatTelemetryCommand: vi.fn().mockReturnValue("scai status"),
  };
});
vi.mock("../../../src/shared/style", () => ({
  showBanner: vi.fn(),
}));
vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: () => {
      throw new Error("Prompt should not run in non-TTY mode.");
    },
  },
}));

describe("cli entrypoint (non-TTY)", () => {
  it("runs without prompting in headless mode", async () => {
    const originalArgv = process.argv;
    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    const originalCI = process.env.CI;
    const originalGH = process.env.GITHUB_ACTIONS;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-headless-"));
    await fs.writeFile(
      path.join(tempDir, "sitecoreai.cli.json"),
      JSON.stringify({ modules: ["./module.module.json"], settings: {} }, null, 2),
      "utf8"
    );

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;

    const telemetry = await import("../../../src/shared/telemetry");
    (
      telemetry.resolveConfigPathFromArgs as unknown as { mockReturnValue: (v: string) => void }
    ).mockReturnValue(tempDir);

    process.argv = ["node", "scai", "status"];
    vi.resetModules();
    await import("../../../src/cli");

    process.argv = originalArgv;
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    if (originalCI !== undefined) {
      process.env.CI = originalCI;
    }
    if (originalGH !== undefined) {
      process.env.GITHUB_ACTIONS = originalGH;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
