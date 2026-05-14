import { afterEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";
import { Logger } from "../../../src/shared/logger";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses info/warn/error output when json is enabled", () => {
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => undefined);
    const logger = new Logger(false, false, true, false);

    logger.info("hello");
    logger.warn("careful");
    logger.error("boom");

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("suppresses output when quiet is enabled", () => {
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);
    const logger = new Logger(false, false, true, true);

    logger.info("hello");

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("suppresses verbose/debug output when json is enabled", () => {
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);

    const verboseLogger = new Logger(true, false, true, false);
    verboseLogger.verbose("details");
    const debugLogger = new Logger(false, true, true, false);
    debugLogger.debug("trace");

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("emits JSON payloads directly to stdout without consola prefix", () => {
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const logger = new Logger(false, false, true, false);

    logger.json({ ok: true });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const written = stdoutSpy.mock.calls[0][0] as string;
    expect(written.endsWith("\n")).toBe(true);
    expect(written.startsWith("ℹ")).toBe(false);
    expect(JSON.parse(written)).toEqual({ ok: true });
  });
});
