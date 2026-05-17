import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai content version inspect` command wiring. The version-inspect
 * task runner is mocked; tests parse the single-level command the way
 * the CLI does and assert the item-targeting flags, numeric `--version`
 * coercion, and env / config / verbosity threading.
 */

const taskMocks = vi.hoisted(() => ({
  runContentVersionInspect: vi.fn(),
}));

vi.mock("../../../../../src/content/tasks/version-inspect", () => taskMocks);

import { createInspectCommand } from "../../../../../src/commands/content/version/inspect";

const runInspect = async (args: string[]): Promise<void> => {
  const command = createInspectCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createInspectCommand — command shape", () => {
  const inspect = createInspectCommand();

  it("declares the item-targeting + env / config / verbosity flags", () => {
    const opts = new Set(inspect.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    for (const long of [
      "--item-id",
      "--path",
      "--language",
      "--version",
      "--environment-name",
      "--config",
      "--json",
    ]) {
      expect(opts.has(long), long).toBe(true);
    }
  });

  it("describes itself as read-only", () => {
    expect(inspect.description()).toContain("Read-only");
  });
});

describe("content version inspect", () => {
  it("delegates to runContentVersionInspect with the parsed option bag", async () => {
    await runInspect(["--quiet", "--path", "/sitecore/content/Home"]);
    expect(taskMocks.runContentVersionInspect).toHaveBeenCalledOnce();
    expect(taskMocks.runContentVersionInspect.mock.calls[0][0]).toMatchObject({
      path: "/sitecore/content/Home",
      quiet: true,
    });
  });

  it("threads --item-id and --language through", async () => {
    await runInspect([
      "--quiet",
      "--item-id",
      "11111111-1111-1111-1111-111111111111",
      "--language",
      "fr-CA",
    ]);
    expect(taskMocks.runContentVersionInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "11111111-1111-1111-1111-111111111111",
        language: "fr-CA",
      })
    );
  });

  it("coerces --version to a number", async () => {
    await runInspect(["--quiet", "--path", "/sitecore/content/Home", "--version", "3"]);
    expect(taskMocks.runContentVersionInspect).toHaveBeenCalledWith(
      expect.objectContaining({ version: 3 })
    );
  });

  it("leaves --version undefined when omitted (defaults to latest)", async () => {
    await runInspect(["--quiet", "--path", "/sitecore/content/Home"]);
    expect(taskMocks.runContentVersionInspect.mock.calls[0][0].version).toBeUndefined();
  });

  it("threads --environment-name through", async () => {
    await runInspect(["--quiet", "--path", "/sitecore/content/Home", "--environment-name", "prod"]);
    expect(taskMocks.runContentVersionInspect).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "prod" })
    );
  });
});
