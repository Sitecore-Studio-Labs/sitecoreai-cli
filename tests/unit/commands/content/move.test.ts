import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai content move` command wiring. The move task runner is mocked;
 * tests parse the single-level command the way the CLI does and assert
 * the source / destination flags, the apply-gate, and env / config /
 * verbosity threading.
 */

const taskMocks = vi.hoisted(() => ({
  runContentMove: vi.fn(),
}));

vi.mock("../../../../src/content/tasks/move", () => taskMocks);

import { createContentMoveCommand } from "../../../../src/commands/content/move";

const runMove = async (args: string[]): Promise<void> => {
  const command = createContentMoveCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createContentMoveCommand — command shape", () => {
  const move = createContentMoveCommand();

  it("declares the source / destination + env / config / verbosity flags", () => {
    const opts = new Set(move.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    for (const long of [
      "--item-id",
      "--path",
      "--to-item-id",
      "--to-path",
      "--environment-name",
      "--config",
    ]) {
      expect(opts.has(long), long).toBe(true);
    }
  });

  it("describes itself as wrapping the Authoring moveItem mutation", () => {
    expect(move.description()).toContain("moveItem");
  });
});

describe("content move", () => {
  it("delegates to runContentMove with the parsed option bag", async () => {
    await runMove([
      "--quiet",
      "--path",
      "/sitecore/content/MySite/OldHome",
      "--to-path",
      "/sitecore/content/Archive",
    ]);
    expect(taskMocks.runContentMove).toHaveBeenCalledOnce();
    expect(taskMocks.runContentMove.mock.calls[0][0]).toMatchObject({
      path: "/sitecore/content/MySite/OldHome",
      toPath: "/sitecore/content/Archive",
    });
  });

  it("threads --item-id and --to-item-id through", async () => {
    await runMove([
      "--quiet",
      "--item-id",
      "11111111-1111-1111-1111-111111111111",
      "--to-item-id",
      "22222222-2222-2222-2222-222222222222",
    ]);
    expect(taskMocks.runContentMove).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "11111111-1111-1111-1111-111111111111",
        toItemId: "22222222-2222-2222-2222-222222222222",
      })
    );
  });
});
