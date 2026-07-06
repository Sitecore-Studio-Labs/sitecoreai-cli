import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatProgressLine,
  progressStreamEnabled,
  writeProgressLine,
} from "../../../src/recipe/tasks/progress-stream";
import type { ExecutionResult } from "../../../src/recipe/runtime/execute";

const resultWith = (
  summary: Partial<ExecutionResult["summary"]>,
  aborted = false
): ExecutionResult => ({
  plan: { schemaVersion: "1", recipeHandle: "x@1", actions: [], summary: {} as never },
  summary: { create: 0, update: 0, skip: 0, error: 0, prune: 0, conflict: 0, ...summary },
  aborted,
  capturedItemIds: new Map(),
});

describe("progressStreamEnabled", () => {
  it("is on only when SITECOREAI_PROGRESS_STREAM is exactly '1'", () => {
    expect(progressStreamEnabled({ SITECOREAI_PROGRESS_STREAM: "1" })).toBe(true);
    expect(progressStreamEnabled({ SITECOREAI_PROGRESS_STREAM: "true" })).toBe(false);
    expect(progressStreamEnabled({ SITECOREAI_PROGRESS_STREAM: "0" })).toBe(false);
    expect(progressStreamEnabled({})).toBe(false);
  });
});

describe("formatProgressLine", () => {
  it("emits the scaiProgress NDJSON contract the orchestrator parses", () => {
    const line = formatProgressLine({
      recipeHandle: "page-home@1",
      index: 12,
      total: 237,
      result: resultWith({ create: 3, update: 8, skip: 4 }),
    });
    expect(JSON.parse(line)).toEqual({
      scaiProgress: 1,
      recipe: "page-home@1",
      index: 12,
      total: 237,
      status: "succeeded",
      summary: { create: 3, update: 8, skip: 4, error: 0 },
    });
    // NDJSON: single line, no embedded newlines.
    expect(line).not.toContain("\n");
  });

  it("marks aborted or error-carrying results as failed", () => {
    const aborted = formatProgressLine({
      recipeHandle: "a@1",
      index: 1,
      total: 2,
      result: resultWith({}, true),
    });
    expect(JSON.parse(aborted).status).toBe("failed");

    const errored = formatProgressLine({
      recipeHandle: "b@1",
      index: 2,
      total: 2,
      result: resultWith({ error: 1 }),
    });
    expect(JSON.parse(errored).status).toBe("failed");
  });
});

describe("writeProgressLine", () => {
  const savedEnv = process.env.SITECOREAI_PROGRESS_STREAM;

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SITECOREAI_PROGRESS_STREAM;
    else process.env.SITECOREAI_PROGRESS_STREAM = savedEnv;
    vi.restoreAllMocks();
  });

  it("writes one newline-terminated line to stderr when enabled", () => {
    process.env.SITECOREAI_PROGRESS_STREAM = "1";
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    writeProgressLine({
      recipeHandle: "c@1",
      index: 1,
      total: 1,
      result: resultWith({ update: 2 }),
    });

    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0][0] as string;
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written).recipe).toBe("c@1");
  });

  it("stays silent when the stream is off (default)", () => {
    delete process.env.SITECOREAI_PROGRESS_STREAM;
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    writeProgressLine({
      recipeHandle: "c@1",
      index: 1,
      total: 1,
      result: resultWith({}),
    });

    expect(write).not.toHaveBeenCalled();
  });
});
