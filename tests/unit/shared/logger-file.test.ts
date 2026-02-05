import { afterEach, describe, expect, it, vi } from "vitest";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("Logger file output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes log entries to a file", async () => {
    vi.resetModules();
    const { Logger } = await import("../../../src/shared/logger");
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "scai-log-"));
    const logPath = path.join(dir, "cli.log");
    const logger = new Logger(false, false, false, false, logPath);

    logger.info("Hello");

    const content = await fsPromises.readFile(logPath, "utf8");
    expect(content).toContain("INFO Hello");
    await fsPromises.rm(dir, { recursive: true, force: true });
  });
});
