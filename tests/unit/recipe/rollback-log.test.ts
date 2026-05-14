import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRollbackLogger,
  resolveRollbackLogDir,
  ROLLBACK_LOG_SCHEMA_VERSION,
} from "../../../src/recipe/rollback-log";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-rollback-log-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const readLogLines = async (logPath: string): Promise<Array<Record<string, unknown>>> => {
  const raw = await fs.readFile(logPath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe("createRollbackLogger", () => {
  it("does not create the file until a step is recorded", async () => {
    const logger = createRollbackLogger("run-empty", { dir: tmpDir });
    expect(logger.wasUsed).toBe(false);
    // Directory not yet created either.
    await expect(fs.access(logger.logPath)).rejects.toThrow();
  });

  it("appends step + summary lines and marks the run as used", async () => {
    const logger = createRollbackLogger("run-1", { dir: tmpDir });
    await logger.recordStep("cta-button@1", {
      index: 2,
      label: "base-templates:cta-button@1",
      status: "success",
      inverse: "updateItem",
    });
    await logger.recordStep("cta-button@1", {
      index: 1,
      label: "template:cta-button@1",
      status: "success",
      inverse: "deleteItem",
      itemId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    await logger.recordSummary("cta-button@1", {
      trigger: "apply-error",
      rolledBack: 2,
      errorCount: 0,
      forwardError: "Sitecore rejected the section",
    });

    expect(logger.wasUsed).toBe(true);

    const lines = await readLogLines(logger.logPath);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.v === ROLLBACK_LOG_SCHEMA_VERSION)).toBe(true);
    expect(lines.every((line) => line.runId === "run-1")).toBe(true);
    expect(lines[0]).toMatchObject({
      kind: "step",
      recipe: "cta-button@1",
      index: 2,
      status: "success",
      inverse: "updateItem",
    });
    expect(lines[1]).toMatchObject({
      kind: "step",
      index: 1,
      inverse: "deleteItem",
      itemId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    expect(lines[2]).toMatchObject({
      kind: "summary",
      trigger: "apply-error",
      rolledBack: 2,
      errorCount: 0,
      forwardError: "Sitecore rejected the section",
    });
  });

  it("captures step failures with their error message", async () => {
    const logger = createRollbackLogger("run-fail", { dir: tmpDir });
    await logger.recordStep("recipe-a", {
      index: 0,
      label: "template:thing",
      status: "failed",
      inverse: "deleteItem",
      itemId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      error: "permission denied",
    });
    const [line] = await readLogLines(logger.logPath);
    expect(line.status).toBe("failed");
    expect(line.error).toBe("permission denied");
  });

  it("redacts secrets in error and reason fields", async () => {
    const logger = createRollbackLogger("run-redact", { dir: tmpDir });
    await logger.recordStep("recipe-a", {
      index: 0,
      label: "template:thing",
      status: "failed",
      error: "token=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa rejected",
    });
    const [line] = await readLogLines(logger.logPath);
    expect(line.error as string).not.toMatch(/ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  });
});

describe("resolveRollbackLogDir", () => {
  it("defaults to ~/.sitecoreai/rollback when no env override is set", () => {
    const previous = process.env.SITECOREAI_ROLLBACK_LOG_DIR;
    delete process.env.SITECOREAI_ROLLBACK_LOG_DIR;
    try {
      expect(resolveRollbackLogDir()).toBe(path.join(os.homedir(), ".sitecoreai", "rollback"));
    } finally {
      if (previous !== undefined) process.env.SITECOREAI_ROLLBACK_LOG_DIR = previous;
    }
  });

  it("honors SITECOREAI_ROLLBACK_LOG_DIR", () => {
    const previous = process.env.SITECOREAI_ROLLBACK_LOG_DIR;
    process.env.SITECOREAI_ROLLBACK_LOG_DIR = "/tmp/custom-rollback-dir";
    try {
      expect(resolveRollbackLogDir()).toBe("/tmp/custom-rollback-dir");
    } finally {
      if (previous === undefined) delete process.env.SITECOREAI_ROLLBACK_LOG_DIR;
      else process.env.SITECOREAI_ROLLBACK_LOG_DIR = previous;
    }
  });
});
