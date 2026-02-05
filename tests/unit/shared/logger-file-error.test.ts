import { afterEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";

const fsMocks = vi.hoisted(() => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const mocked = {
    ...actual,
    appendFileSync: (...args: unknown[]) => fsMocks.appendFileSync(...args),
    mkdirSync: (...args: unknown[]) => fsMocks.mkdirSync(...args),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

describe("Logger log file failures", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("warns once when log file writing fails", async () => {
    vi.resetModules();
    const { Logger } = await import("../../../src/shared/logger");
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    fsMocks.mkdirSync.mockImplementation(() => undefined);
    fsMocks.appendFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });

    const logger = new Logger(false, false, false, false, "/tmp/scai-log.txt");
    logger.info("first");
    logger.info("second");

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("suppresses log file warnings when json is enabled", async () => {
    vi.resetModules();
    const { Logger } = await import("../../../src/shared/logger");
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    fsMocks.mkdirSync.mockImplementation(() => undefined);
    fsMocks.appendFileSync.mockImplementation(() => {
      throw new Error("no access");
    });

    const logger = new Logger(false, false, true, false, "/tmp/scai-log.txt");
    logger.info("hidden");

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("suppresses log file warnings when quiet is enabled", async () => {
    vi.resetModules();
    const { Logger } = await import("../../../src/shared/logger");
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    fsMocks.mkdirSync.mockImplementation(() => undefined);
    fsMocks.appendFileSync.mockImplementation(() => {
      throw new Error("no access");
    });

    const logger = new Logger(false, false, false, true, "/tmp/scai-log.txt");
    logger.info("hidden");

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
