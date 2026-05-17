/**
 * `scai cli topics` `--json` option plumbing.
 *
 * Distinct from `topics.test.ts`, which mocks `toLogger` to drive the
 * renderer directly. This suite uses the REAL `toLogger` so it exercises
 * Commander's option parsing end-to-end: `topics` registers the verbosity
 * flags (it has its own bare-command action) AND so do the `list` / `show`
 * subcommands, so a post-subcommand `--json` is parsed onto the `topics`
 * ancestor. The renderers must read the ancestor-inclusive option view
 * (`optsWithGlobals()`) or `--json` is silently dropped on the subcommands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../../src/shared/logger";
import { createTopicsCommand, __topicsForTest } from "../../../src/commands/topics";

let jsonSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  jsonSpy = vi.spyOn(Logger.prototype, "json").mockImplementation(() => undefined);
  infoSpy = vi.spyOn(Logger.prototype, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("topics — --json reaches the subcommand logger", () => {
  it("`topics list --json` emits the topics.list JSON envelope", async () => {
    await createTopicsCommand().parseAsync(["node", "topics", "list", "--json"]);

    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(jsonSpy.mock.calls[0][0]).toMatchObject({ command: "topics.list" });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("`topics show <name> --json` emits the topics.show JSON envelope", async () => {
    const known = __topicsForTest[0];
    await createTopicsCommand().parseAsync(["node", "topics", "show", known.name, "--json"]);

    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(jsonSpy.mock.calls[0][0]).toMatchObject({
      command: "topics.show",
      data: { name: known.name },
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("bare `topics --json` emits the topics.list JSON envelope", async () => {
    await createTopicsCommand().parseAsync(["node", "topics", "--json"]);

    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(jsonSpy.mock.calls[0][0]).toMatchObject({ command: "topics.list" });
  });

  it("without --json the subcommands stay in human-readable mode", async () => {
    await createTopicsCommand().parseAsync(["node", "topics", "list"]);

    expect(jsonSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
  });
});
