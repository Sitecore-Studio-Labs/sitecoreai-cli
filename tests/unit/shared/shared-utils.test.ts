import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { consola } from "consola";
import { resolveOutputOptionsFromArgs } from "../../../src/shared/output";
import { createCliError, toCliError, withHint } from "../../../src/shared/errors";
import { redactArgs, redactSecrets } from "../../../src/shared/redact";
import { assertValidHost, assertValidUrl } from "../../../src/shared/validate";
import { recordHistory, ensureHistoryFile } from "../../../src/shared/history";
import { Logger } from "../../../src/shared/logger";
import { startSpinner } from "../../../src/shared/spinner";

describe("shared utilities", () => {
  it("resolves output options from args", () => {
    expect(resolveOutputOptionsFromArgs(["--json", "--quiet"])).toEqual({
      json: true,
      quiet: true,
      logFile: undefined,
    });
    expect(resolveOutputOptionsFromArgs(["--log-file", "out.log"])).toEqual({
      json: false,
      quiet: false,
      logFile: "out.log",
    });
    expect(resolveOutputOptionsFromArgs(["--log-file=inline.log", "-q"])).toEqual({
      json: false,
      quiet: true,
      logFile: "inline.log",
    });
  });

  it("creates and wraps CLI errors with hints", () => {
    const err = createCliError("Bad config", "CONFIG_INVALID", { hint: "Fix it" });
    expect(err.code).toBe("CONFIG_INVALID");
    expect(err.exitCode).toBe(2);
    const wrapped = withHint(err, "Another hint");
    expect(wrapped.hint).toBe("Another hint");
    expect(toCliError(new Error("Boom")).code).toBe("UNKNOWN");
  });

  it("redacts secrets from strings", () => {
    expect(redactSecrets("Bearer abc.def")).toContain("<redacted>");
    expect(redactSecrets("access_token=secret")).toContain("<redacted>");
    expect(redactSecrets('{"refresh_token":"secret"}')).toContain("<redacted>");
    // camelCase variants (formerly missed)
    expect(redactSecrets("accessToken=hush")).toContain("<redacted>");
    expect(redactSecrets("accessToken=hush")).not.toContain("hush");
    expect(redactSecrets("refreshToken: hush")).not.toContain("hush");
    expect(redactSecrets("clientSecret=hush")).not.toContain("hush");
    expect(redactSecrets('{"clientSecret":"hush"}')).not.toContain("hush");
    expect(redactSecrets("password=hush")).not.toContain("hush");
    expect(redactSecrets("client_id=visible-but-still-redacted")).not.toContain(
      "visible-but-still-redacted"
    );
  });

  it("redacts sensitive CLI args", () => {
    const result = redactArgs([
      "deploy",
      "--deploy-token",
      "secret",
      "--client-secret=topsecret",
      "--flag",
      "value",
    ]);
    expect(result).toContain("<redacted>");
    expect(result.some((entry) => entry === "secret")).toBe(false);
    expect(result.some((entry) => entry.includes("topsecret"))).toBe(false);
    expect(result).toContain("--client-secret=<redacted>");
  });

  it("validates URLs and hosts", () => {
    expect(() => assertValidUrl("https://example.com", "Authority")).not.toThrow();
    expect(() => assertValidHost("example.com", "CM host")).not.toThrow();
    expect(() => assertValidHost("https://example.com", "CM host")).not.toThrow();
    expect(() => assertValidUrl("not-a-url", "Authority")).toThrow();
    expect(() => assertValidHost("bad host", "CM host")).toThrow();
  });

  it("writes history entries", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-history-"));
    const historyPath = path.join(dir, "history.log");
    process.env.SITECOREAI_HISTORY_PATH = historyPath;

    await ensureHistoryFile();
    await recordHistory({
      event: "start",
      command: "scai status",
      args: ["deploy", "--deploy-token", "secret"],
      cwd: dir,
      error: "deployToken=secret",
    });

    const content = await fs.readFile(historyPath, "utf8");
    expect(content).toContain('"event":"start"');
    expect(content).not.toContain("secret");
    expect(content).toContain("<redacted>");

    delete process.env.SITECOREAI_HISTORY_PATH;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rotates history when max size is exceeded", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-history-"));
    const historyPath = path.join(dir, "history.log");
    process.env.SITECOREAI_HISTORY_PATH = historyPath;
    process.env.SITECOREAI_HISTORY_MAX_BYTES = "10";

    await ensureHistoryFile();
    await recordHistory({
      event: "start",
      command: "scai status",
      args: ["status"],
      cwd: dir,
    });

    await recordHistory({
      event: "success",
      command: "scai status",
      args: ["status"],
      cwd: dir,
    });

    const files = await fs.readdir(dir);
    const rotated = files.filter((entry) => entry.startsWith("history.log."));
    expect(rotated.length).toBeGreaterThan(0);

    delete process.env.SITECOREAI_HISTORY_PATH;
    delete process.env.SITECOREAI_HISTORY_MAX_BYTES;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes logs and respects json/quiet settings", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-logger-"));
    const logPath = path.join(dir, "app.log");
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => undefined);

    const logger = new Logger(true, true, false, false, logPath);
    logger.info("Hello");
    logger.error("Oops");
    expect(infoSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    const logContent = await fs.readFile(logPath, "utf8");
    expect(logContent).toContain("Hello");

    const jsonLogger = new Logger(false, false, true, false);
    jsonLogger.json({ ok: true });
    expect(infoSpy).toHaveBeenCalled();

    infoSpy.mockRestore();
    errorSpy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("emits verbose and trace logs when enabled", () => {
    const debugSpy = vi.spyOn(consola, "debug").mockImplementation(() => undefined);
    const traceSpy = vi.spyOn(consola, "trace").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => undefined);

    const logger = new Logger(true, true, false, false);
    logger.verbose("Verbose");
    logger.debug("Debug");
    logger.trace("Trace");
    expect(debugSpy).toHaveBeenCalled();
    expect(traceSpy).toHaveBeenCalled();

    const jsonLogger = new Logger(false, false, true, false);
    jsonLogger.error("Oops");
    expect(errorSpy).not.toHaveBeenCalled();

    debugSpy.mockRestore();
    traceSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns null spinner when not TTY or quiet/json", async () => {
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const spinner = await startSpinner("Working");
    expect(spinner).toBeNull();
    Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
  });
});
