import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";
import { Logger } from "../../../src/shared/logger";

/**
 * Walk every level branch on Logger — info / warn / error / verbose /
 * debug / trace / json. Each level has the same gating shape:
 *
 *  - quiet → return without writing to consola
 *  - json → return without writing to consola
 *  - verbose-only or trace-only gates (verbose/debug/trace)
 *  - color default branches when no color is passed
 *
 * Plus the `log(level, ...)` dispatcher's switch covers six named cases
 * plus a defensive default that routes unknown levels through `info`.
 */

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let debugSpy: ReturnType<typeof vi.spyOn>;
let traceSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined as never);
  warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined as never);
  errorSpy = vi.spyOn(consola, "error").mockImplementation(() => undefined as never);
  debugSpy = vi.spyOn(consola, "debug").mockImplementation(() => undefined as never);
  traceSpy = vi.spyOn(consola, "trace").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Logger — quiet suppresses every non-error level", () => {
  const logger = new Logger(true, true, false, true);

  it("info / warn / verbose / debug / trace all skip consola under quiet", () => {
    logger.info("hi");
    logger.warn("hi");
    logger.verbose("hi");
    logger.debug("hi");
    logger.trace("hi");
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(traceSpy).not.toHaveBeenCalled();
  });

  it("error still writes under quiet (errors aren't suppressible)", () => {
    logger.error("boom");
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("isQuiet / isJson / isVerbose reflect the constructor flags", () => {
    expect(logger.isQuiet()).toBe(true);
    expect(logger.isJson()).toBe(false);
    expect(logger.isVerbose()).toBe(true);
  });
});

describe("Logger — json suppresses every level including error consola write", () => {
  const logger = new Logger(true, true, true, false);

  it("info / warn / error / verbose / debug / trace all skip consola under json", () => {
    logger.info("x");
    logger.warn("x");
    logger.error("x");
    logger.verbose("x");
    logger.debug("x");
    logger.trace("x");
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(traceSpy).not.toHaveBeenCalled();
  });

  it("json() writes the JSON-serialised payload to stdout directly", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logger.json({ ok: true, count: 3 });
    expect(stdoutSpy).toHaveBeenCalledWith(`${JSON.stringify({ ok: true, count: 3 }, null, 2)}\n`);
  });

  it("isJson reflects the constructor flag", () => {
    expect(logger.isJson()).toBe(true);
  });
});

describe("Logger — verbose / debug / trace gated by their level flags", () => {
  it("verbose() writes under verboseEnabled=true; skips when only trace is true", () => {
    const verboseOnly = new Logger(true, false);
    verboseOnly.verbose("v");
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockClear();
    const traceOnly = new Logger(false, true);
    traceOnly.verbose("v");
    // verbose only fires when verboseEnabled is true; traceEnabled alone
    // doesn't unlock it.
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("debug() requires verbose or trace; both off → no write", () => {
    const off = new Logger(false, false);
    off.debug("d");
    expect(debugSpy).not.toHaveBeenCalled();
    const traceOn = new Logger(false, true);
    traceOn.debug("d");
    expect(debugSpy).toHaveBeenCalled();
  });

  it("trace() requires traceEnabled exactly", () => {
    const off = new Logger(false, false);
    off.trace("t");
    expect(traceSpy).not.toHaveBeenCalled();
    const traceOn = new Logger(false, true);
    traceOn.trace("t");
    expect(traceSpy).toHaveBeenCalled();
  });
});

describe("Logger — colorize default branches", () => {
  const logger = new Logger(true, false);

  it("warn defaults to yellow when no color is passed", () => {
    logger.warn("y");
    const out = warnSpy.mock.calls[0][0] as string;
    expect(out).toContain("\x1b[33m");
  });

  it("error defaults to red when no color is passed", () => {
    logger.error("r");
    const out = errorSpy.mock.calls[0][0] as string;
    expect(out).toContain("\x1b[31m");
  });

  it("info uses the caller-supplied color when present", () => {
    logger.info("g", "green");
    const out = infoSpy.mock.calls[0][0] as string;
    expect(out).toContain("\x1b[32m");
  });

  it("info with no color passes the message through colorize unchanged", () => {
    logger.info("plain");
    const out = infoSpy.mock.calls[0][0] as string;
    // formatMessage prepends a timestamp when verboseEnabled, so the
    // assertion is on the message tail, not equality.
    expect(out).toContain("plain");
    // No ANSI sequence appended for no-color branch.
    expect(out.endsWith("plain")).toBe(true);
  });
});

describe("Logger.log dispatch — every level + default branch", () => {
  const logger = new Logger(true, true);
  for (const level of ["info", "warn", "error", "verbose", "debug", "trace"] as const) {
    it(`routes log("${level}", ...) through the ${level} branch`, () => {
      const fnSpy = vi.spyOn(logger, level);
      logger.log(level, "m");
      expect(fnSpy).toHaveBeenCalledWith("m", undefined);
    });
  }

  it("falls through to info() for an unknown level (default arm)", () => {
    const infoFnSpy = vi.spyOn(logger, "info");
    // The `default` arm of the switch — pass a level not in LogLevel.
    logger.log("unknown" as never, "u");
    expect(infoFnSpy).toHaveBeenCalledWith("u", undefined);
  });
});
