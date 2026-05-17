/**
 * `scai cli topics` curated index — tests pin the shape (slug uniqueness,
 * non-empty descriptions, ≥1 command per topic) so a future edit
 * can't accidentally publish a half-defined entry.
 *
 * The `createTopicsCommand` suite drives the renderer through its
 * branches: the list vs single-topic forks, the JSON vs human-readable
 * forks, and the unknown-topic error path. `toLogger` is mocked so the
 * fake Logger's `isJson()` can be flipped per-test and the `json` /
 * `info` / `warn` call args asserted directly — the topics renderer is
 * the unit under test, not Commander's option plumbing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerState = vi.hoisted(() => {
  const make = (jsonEnabled: boolean) => ({
    jsonEnabled,
    isJson: () => jsonEnabled,
    json: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  });
  return { jsonEnabled: false, current: make(false), make };
});

vi.mock("../../../src/shared/cli-tasks", async () => {
  const actual = await vi.importActual<typeof import("../../../src/shared/cli-tasks")>(
    "../../../src/shared/cli-tasks"
  );
  return {
    ...actual,
    toLogger: () => {
      loggerState.current = loggerState.make(loggerState.jsonEnabled);
      return loggerState.current;
    },
  };
});

import { __topicsForTest, createTopicsCommand } from "../../../src/commands/topics";

describe("topics", () => {
  it("has at least one topic defined", () => {
    expect(__topicsForTest.length).toBeGreaterThan(0);
  });

  it("uses unique kebab-case slugs", () => {
    const slugs = __topicsForTest.map((t) => t.name);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("requires every topic to carry a description and ≥1 command", () => {
    for (const t of __topicsForTest) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.commands.length).toBeGreaterThan(0);
      for (const c of t.commands) {
        expect(c.command).toMatch(/^scai /);
        expect(c.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("includes the diagnose-blocked-delete topic referencing explain why-blocked", () => {
    const topic = __topicsForTest.find((t) => t.name === "diagnose-blocked-delete");
    expect(topic).toBeDefined();
    expect(topic?.commands.some((c) => c.command.includes("explain why-blocked"))).toBe(true);
  });

  it("includes the manage-known-debt topic referencing baseline accept", () => {
    const topic = __topicsForTest.find((t) => t.name === "manage-known-debt");
    expect(topic).toBeDefined();
    expect(topic?.commands.some((c) => c.command.includes("baseline accept"))).toBe(true);
  });

  it("includes the pipeline-audit-cleanup topic referencing --from-stdin", () => {
    const topic = __topicsForTest.find((t) => t.name === "pipeline-audit-cleanup");
    expect(topic).toBeDefined();
    expect(topic?.commands.some((c) => c.command.includes("--from-stdin"))).toBe(true);
  });
});

describe("createTopicsCommand", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    loggerState.jsonEnabled = false;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("bare `topics` renders the human-readable index via info()", async () => {
    const cmd = createTopicsCommand();
    await cmd.parseAsync(["node", "topics"]);

    const logger = loggerState.current;
    expect(logger.json).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "scai cli topics — intent-based command index",
      "cyan"
    );
    // Every topic slug surfaces in a yellow info line.
    for (const t of __topicsForTest) {
      expect(logger.info).toHaveBeenCalledWith(`  ${t.name}`, "yellow");
    }
  });

  it("bare `topics` in JSON mode emits a single topics.list envelope", async () => {
    loggerState.jsonEnabled = true;
    const cmd = createTopicsCommand();
    await cmd.parseAsync(["node", "topics"]);

    const logger = loggerState.current;
    expect(logger.json).toHaveBeenCalledTimes(1);
    const envelope = logger.json.mock.calls[0][0] as {
      command: string;
      data: { name: string; description: string }[];
    };
    expect(envelope.command).toBe("topics.list");
    expect(envelope.data.map((t) => t.name)).toEqual(__topicsForTest.map((t) => t.name));
    // The list envelope is the trimmed projection — name + description only.
    expect(Object.keys(envelope.data[0]).sort()).toEqual(["description", "name"]);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("`topics list` renders the human-readable index", async () => {
    const cmd = createTopicsCommand();
    await cmd.parseAsync(["node", "topics", "list"]);

    const logger = loggerState.current;
    expect(logger.json).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "scai cli topics — intent-based command index",
      "cyan"
    );
  });

  it("`topics list` in JSON mode emits the topics.list envelope", async () => {
    loggerState.jsonEnabled = true;
    const cmd = createTopicsCommand();
    await cmd.parseAsync(["node", "topics", "list"]);

    const logger = loggerState.current;
    expect(logger.json).toHaveBeenCalledTimes(1);
    const envelope = logger.json.mock.calls[0][0] as { command: string; data: unknown[] };
    expect(envelope.command).toBe("topics.list");
    expect(envelope.data.length).toBe(__topicsForTest.length);
  });

  it("`topics show <name>` renders the full single-topic detail", async () => {
    const known = __topicsForTest[0];
    const cmd = createTopicsCommand();
    await cmd.parseAsync(["node", "topics", "show", known.name]);

    const logger = loggerState.current;
    expect(logger.json).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(`scai cli topics: ${known.name}`, "cyan");
    // Each command in the topic prints its command string in yellow.
    for (const c of known.commands) {
      expect(logger.info).toHaveBeenCalledWith(`  ${c.command}`, "yellow");
    }
  });

  it("`topics show <name>` in JSON mode emits the topics.show envelope with the whole topic", async () => {
    loggerState.jsonEnabled = true;
    const known = __topicsForTest[0];
    const cmd = createTopicsCommand();
    await cmd.parseAsync(["node", "topics", "show", known.name]);

    const logger = loggerState.current;
    expect(logger.json).toHaveBeenCalledTimes(1);
    const envelope = logger.json.mock.calls[0][0] as {
      command: string;
      data: { name: string; commands: unknown[] };
    };
    expect(envelope.command).toBe("topics.show");
    expect(envelope.data.name).toBe(known.name);
    expect(envelope.data.commands.length).toBe(known.commands.length);
  });

  it("`topics show <unknown>` warns, sets exit code 1, and prints nothing", async () => {
    const cmd = createTopicsCommand();
    process.exitCode = 0;
    await cmd.parseAsync(["node", "topics", "show", "no-such-topic"]);

    const logger = loggerState.current;
    expect(process.exitCode).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown topic 'no-such-topic'")
    );
    expect(logger.json).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("`topics show <unknown>` in JSON mode still warns and never emits a topics.show envelope", async () => {
    loggerState.jsonEnabled = true;
    const cmd = createTopicsCommand();
    process.exitCode = 0;
    await cmd.parseAsync(["node", "topics", "show", "ghost"]);

    const logger = loggerState.current;
    expect(process.exitCode).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Unknown topic 'ghost'"));
    expect(logger.json).not.toHaveBeenCalled();
  });
});
