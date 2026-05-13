import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: class {
    getPassword() {
      return Promise.resolve("token");
    }
    setPassword() {
      return Promise.resolve();
    }
    deleteCredential() {
      return Promise.resolve(true);
    }
  },
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: () => ({
      succeed: vi.fn(),
      fail: vi.fn(),
    }),
  })),
}));

let questionSpy = vi.fn().mockResolvedValue("y");
vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: () => ({
      question: questionSpy,
      close: vi.fn(),
    }),
  },
}));

describe("telemetry and shared helpers", () => {
  const originalEnv = { ...process.env };
  const originalStdinTty = process.stdin.isTTY;
  const originalStdoutTty = process.stdout.isTTY;

  beforeEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinTty,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutTty,
      configurable: true,
    });
    questionSpy = vi.fn().mockResolvedValue("y");
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
  it("formats telemetry commands and resolves config args", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    expect(telemetry.formatTelemetryCommand(["deploy", "logs", "list", "--config", "x"])).toBe(
      "deploy logs list"
    );
    expect(telemetry.resolveConfigPathFromArgs(["--config", "/tmp/config.json"])).toBe(
      "/tmp/config.json"
    );
    expect(telemetry.resolveConfigPathFromArgs(["--config=/tmp/config.json"])).toBe(
      "/tmp/config.json"
    );
  });

  it("returns a placeholder when no command tokens exist", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    expect(telemetry.formatTelemetryCommand(["--config", "x"])).toBe("(no command)");
  });

  it("recipe commands telemetry-flatten to bare positional tokens (no recipe paths/env names leak)", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    expect(
      telemetry.formatTelemetryCommand([
        "recipe",
        "push",
        "--input",
        "./recipes/cta-button.recipe.ts",
        "--environment-name",
        "my-tenant",
        "--allow-write",
      ])
    ).toBe("recipe push");
    expect(
      telemetry.formatTelemetryCommand([
        "recipe",
        "compile",
        "-i",
        "./recipes/secret-internal-handle.recipe.ts",
      ])
    ).toBe("recipe compile");
  });

  it("returns undefined when no config flag is provided", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    expect(telemetry.resolveConfigPathFromArgs(["--json"])).toBeUndefined();
  });

  it("records telemetry when enabled", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.SITECOREAI_TELEMETRY = "1";
    process.env.SITECOREAI_TELEMETRY_URL = "https://telemetry.example/v1/t";

    await telemetry.recordTelemetry({
      event: "command_success",
      command: "scai status",
      args: [],
      durationMs: 10,
    });

    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
    delete process.env.SITECOREAI_TELEMETRY;
    delete process.env.SITECOREAI_TELEMETRY_URL;
  });

  it("skips telemetry consent when overridden", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    process.env.SITECOREAI_TELEMETRY = "1";
    questionSpy.mockClear();
    await telemetry.ensureTelemetryConsent(process.cwd());
    expect(questionSpy).not.toHaveBeenCalled();
    delete process.env.SITECOREAI_TELEMETRY;
  });

  it("skips telemetry consent when disabled by env", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    process.env.DISABLE_TELEMETRY = "1";
    questionSpy.mockClear();
    await telemetry.ensureTelemetryConsent(process.cwd());
    expect(questionSpy).not.toHaveBeenCalled();
    delete process.env.DISABLE_TELEMETRY;
  });

  it("prompts for telemetry consent and writes config", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-"));
    await fs.writeFile(
      path.join(dir, "sitecoreai.cli.json"),
      JSON.stringify(
        {
          modules: ["./module.module.json"],
          settings: {},
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(dir, "module.module.json"), "{}", "utf8");

    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    const originalCI = process.env.CI;
    const originalGH = process.env.GITHUB_ACTIONS;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.DISABLE_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    questionSpy.mockResolvedValueOnce("y");
    await telemetry.ensureTelemetryConsent(dir);
    const updated = JSON.parse(await fs.readFile(path.join(dir, "sitecoreai.cli.json"), "utf8"));
    expect(updated.settings.telemetryEnabled).toBe(true);
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    if (originalCI !== undefined) {
      process.env.CI = originalCI;
    }
    if (originalGH !== undefined) {
      process.env.GITHUB_ACTIONS = originalGH;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads telemetry status from env", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    process.env.SITECOREAI_TELEMETRY = "0";
    const status = telemetry.getTelemetryStatus(process.cwd());
    expect(status.enabled).toBe(false);
    delete process.env.SITECOREAI_TELEMETRY;
  });

  it("returns config-not-found status when config is missing", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-missing-"));
    const status = telemetry.getTelemetryStatus(dir);
    expect(status.enabled).toBe(false);
    expect(status.source).toBe("config not found");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("skips telemetry consent when config is missing", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-missing-"));
    questionSpy.mockClear();
    await telemetry.ensureTelemetryConsent(dir);
    expect(questionSpy).not.toHaveBeenCalled();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("skips telemetry consent when config already has a value", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-existing-"));
    await fs.writeFile(
      path.join(dir, "sitecoreai.cli.json"),
      JSON.stringify(
        { modules: ["./module.module.json"], settings: { telemetryEnabled: false } },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(dir, "module.module.json"), "{}", "utf8");

    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    questionSpy.mockClear();

    await telemetry.ensureTelemetryConsent(dir);

    expect(questionSpy).not.toHaveBeenCalled();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("skips telemetry consent in CI", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-ci-"));
    await fs.writeFile(
      path.join(dir, "sitecoreai.cli.json"),
      JSON.stringify({ modules: ["./module.module.json"], settings: {} }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(dir, "module.module.json"), "{}", "utf8");

    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    const originalCI = process.env.CI;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.CI = "1";
    questionSpy.mockClear();

    await telemetry.ensureTelemetryConsent(dir);
    expect(questionSpy).not.toHaveBeenCalled();

    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes telemetry disabled when user declines", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const { consola } = await import("consola");
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-decline-"));
    await fs.writeFile(
      path.join(dir, "sitecoreai.cli.json"),
      JSON.stringify({ modules: ["./module.module.json"], settings: {} }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(dir, "module.module.json"), "{}", "utf8");

    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    questionSpy.mockResolvedValueOnce("n");

    await telemetry.ensureTelemetryConsent(dir);

    const updated = JSON.parse(await fs.readFile(path.join(dir, "sitecoreai.cli.json"), "utf8"));
    expect(updated.settings.telemetryEnabled).toBe(false);
    expect(infoSpy).toHaveBeenCalledWith("Telemetry disabled. You can re-enable it later.");

    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    infoSpy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("logs debug when telemetry prompt fails", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const { consola } = await import("consola");
    const debugSpy = vi.spyOn(consola, "debug").mockImplementation(() => undefined);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-fail-"));
    await fs.writeFile(
      path.join(dir, "sitecoreai.cli.json"),
      JSON.stringify({ modules: ["./module.module.json"], settings: {} }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(dir, "module.module.json"), "{}", "utf8");

    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    const originalCI = process.env.CI;
    const originalGH = process.env.GITHUB_ACTIONS;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    questionSpy.mockRejectedValueOnce(new Error("prompt failure"));

    await telemetry.ensureTelemetryConsent(dir);

    expect(debugSpy).toHaveBeenCalled();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    if (originalCI !== undefined) {
      process.env.CI = originalCI;
    }
    if (originalGH !== undefined) {
      process.env.GITHUB_ACTIONS = originalGH;
    }
    debugSpy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("shows banner and starts spinner", async () => {
    const style = await import("../../../src/shared/style");
    const spinner = await import("../../../src/shared/spinner");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.SITECOREAI_BANNER = "1";
    style.showBanner();
    const result = await spinner.startSpinner("Working");
    expect(result).not.toBeNull();
    logSpy.mockRestore();
    delete process.env.SITECOREAI_BANNER;
    Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
  });

  it("skips telemetry when URL is empty or disabled", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    process.env.SITECOREAI_TELEMETRY = "1";
    process.env.SITECOREAI_TELEMETRY_URL = "";
    await telemetry.recordTelemetry({
      event: "command_start",
      command: "scai status",
      args: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.SITECOREAI_TELEMETRY_URL = "https://telemetry.example/v1/t";
    process.env.SITECOREAI_TELEMETRY = "0";
    await telemetry.recordTelemetry({
      event: "command_start",
      command: "scai status",
      args: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    delete process.env.SITECOREAI_TELEMETRY;
    delete process.env.SITECOREAI_TELEMETRY_URL;
  });

  it("reports telemetry status from DO_NOT_TRACK", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    process.env.DO_NOT_TRACK = "1";
    const status = telemetry.getTelemetryStatus(process.cwd());
    expect(status.enabled).toBe(false);
    expect(status.source).toBe("env DISABLE_TELEMETRY/DO_NOT_TRACK");
    delete process.env.DO_NOT_TRACK;
  });

  it("logs validation failures for invalid telemetry payloads", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const { consola } = await import("consola");
    const debugSpy = vi.spyOn(consola, "debug").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    process.env.SITECOREAI_TELEMETRY = "1";
    process.env.SITECOREAI_TELEMETRY_URL = "https://telemetry.example/v1/t";

    await telemetry.recordTelemetry({
      event: "command_success",
      command: "scai status",
      args: [],
      durationMs: -1,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
    vi.unstubAllGlobals();
    delete process.env.SITECOREAI_TELEMETRY;
    delete process.env.SITECOREAI_TELEMETRY_URL;
  });

  it("retries telemetry with backoff when request fails", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    process.env.SITECOREAI_TELEMETRY = "1";
    process.env.SITECOREAI_TELEMETRY_URL = "https://telemetry.example/v1/t";
    process.env.SITECOREAI_TELEMETRY_RETRIES = "1";
    process.env.SITECOREAI_TELEMETRY_RETRY_BASE_MS = "1";

    await telemetry.recordTelemetry({
      event: "command_start",
      command: "scai status",
      args: [],
    });

    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.SITECOREAI_TELEMETRY;
    delete process.env.SITECOREAI_TELEMETRY_URL;
    delete process.env.SITECOREAI_TELEMETRY_RETRIES;
    delete process.env.SITECOREAI_TELEMETRY_RETRY_BASE_MS;
  });

  it("emits trace logs on failed telemetry requests", async () => {
    const telemetry = await import("../../../src/shared/telemetry");
    const { consola } = await import("consola");
    const debugSpy = vi.spyOn(consola, "debug").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    process.env.SITECOREAI_TELEMETRY = "1";
    process.env.SITECOREAI_TELEMETRY_URL = "https://telemetry.example/v1/t";
    process.env.SITECOREAI_TRACE_HTTP = "1";
    process.env.SITECOREAI_TELEMETRY_RETRIES = "0";

    await telemetry.recordTelemetry({
      event: "command_error",
      command: "scai status",
      args: [],
      durationMs: 5,
      error: "boom",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(debugSpy).toHaveBeenCalled();

    debugSpy.mockRestore();
    vi.unstubAllGlobals();
    delete process.env.SITECOREAI_TELEMETRY;
    delete process.env.SITECOREAI_TELEMETRY_URL;
    delete process.env.SITECOREAI_TRACE_HTTP;
    delete process.env.SITECOREAI_TELEMETRY_RETRIES;
  });

  it("writes config templates", async () => {
    const configTemplate = await import("../../../src/shared/config-template");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-template-"));
    const target = configTemplate.resolveTargetPath(dir);
    configTemplate.writeConfigTemplate(target);
    const contents = await fs.readFile(target, "utf8");
    expect(contents).toContain("sitecoreai.cli.json");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("handles keychain operations", async () => {
    vi.resetModules();
    const keychain = await import("../../../src/shared/keychain");
    const token = await keychain.getDeployToken("demo");
    expect(token).toBe("token");
    const stored = await keychain.setDeployToken("demo", "token");
    expect(stored).toBe(true);
    const cleared = await keychain.clearDeployToken("demo");
    expect(cleared).toBe(true);
  });
});
