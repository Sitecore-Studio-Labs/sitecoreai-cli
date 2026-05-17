import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai serialization …` action delegation. The structural option
 * surface is covered by `serialization-commands.test.ts`; this file
 * mocks the serialization task runners and asserts that each
 * subcommand factory wires its `.action()` to the right runner and
 * forwards the parsed option bag (include/exclude accumulators,
 * what-if, force, allow-write, diff source/destination).
 */

const taskMocks = vi.hoisted(() => ({
  runDiff: vi.fn(),
  runExplain: vi.fn(),
  runInfo: vi.fn(),
  runPull: vi.fn(),
  runPush: vi.fn(),
  runValidate: vi.fn(),
  runWatch: vi.fn(),
}));

vi.mock("../../../../src/serialization/tasks/diff", () => ({ runDiff: taskMocks.runDiff }));
vi.mock("../../../../src/serialization/tasks/info", () => ({
  runExplain: taskMocks.runExplain,
  runInfo: taskMocks.runInfo,
}));
vi.mock("../../../../src/serialization/tasks/pull", () => ({ runPull: taskMocks.runPull }));
vi.mock("../../../../src/serialization/tasks/push", () => ({ runPush: taskMocks.runPush }));
vi.mock("../../../../src/serialization/tasks/validate", () => ({
  runValidate: taskMocks.runValidate,
}));
vi.mock("../../../../src/serialization/tasks/watch", () => ({ runWatch: taskMocks.runWatch }));

import { createSerializationCommand } from "../../../../src/commands/serialization";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runSer = async (args: string[]): Promise<void> => {
  const command = createSerializationCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSerializationCommand — command tree", () => {
  const ser = createSerializationCommand();

  it("registers every verb plus the package group", () => {
    for (const name of [
      "diff",
      "explain",
      "info",
      "package",
      "pull",
      "push",
      "validate",
      "watch",
    ]) {
      expect(sub(ser, name), name).toBeDefined();
    }
  });

  it("exposes the `ser` alias", () => {
    expect(ser.aliases()).toContain("ser");
  });
});

describe("serialization info", () => {
  it("delegates to runInfo with the parsed option bag", async () => {
    await runSer(["info", "--quiet"]);
    expect(taskMocks.runInfo).toHaveBeenCalledOnce();
    expect(taskMocks.runInfo.mock.calls[0][0]).toMatchObject({ quiet: true });
  });

  it("threads accumulated --include / --exclude arrays through", async () => {
    await runSer(["info", "--include", "a,b", "--exclude", "c", "--quiet"]);
    expect(taskMocks.runInfo).toHaveBeenCalledWith(
      expect.objectContaining({ include: ["a", "b"], exclude: ["c"] })
    );
  });
});

describe("serialization explain", () => {
  it("threads --path + --database into runExplain", async () => {
    await runSer(["explain", "--path", "/sitecore/content/Home", "--database", "web", "--quiet"]);
    expect(taskMocks.runExplain).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/sitecore/content/Home", database: "web" })
    );
  });
});

describe("serialization pull", () => {
  it("delegates to runPull and threads --what-if / --force", async () => {
    await runSer(["pull", "--environment-name", "demo", "--what-if", "--force", "--quiet"]);
    expect(taskMocks.runPull).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "demo", whatIf: true, force: true })
    );
  });
});

describe("serialization push", () => {
  it("delegates to runPush and threads --allow-write", async () => {
    await runSer(["push", "--environment-name", "demo", "--allow-write", "--quiet"]);
    expect(taskMocks.runPush).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "demo", allowWrite: true })
    );
  });

  it("defaults whatIf / force to undefined when their flags are omitted", async () => {
    await runSer(["push", "--quiet"]);
    const call = taskMocks.runPush.mock.calls.at(-1)?.[0];
    expect(call.whatIf).toBeUndefined();
    expect(call.force).toBeUndefined();
  });
});

describe("serialization diff", () => {
  it("threads --source / --destination / --push into runDiff", async () => {
    await runSer(["diff", "--source", "demo", "--destination", "prod", "--push", "--quiet"]);
    expect(taskMocks.runDiff).toHaveBeenCalledWith(
      expect.objectContaining({ source: "demo", destination: "prod", push: true })
    );
  });
});

describe("serialization validate", () => {
  it("threads the --fix flag into runValidate", async () => {
    await runSer(["validate", "--fix", "--quiet"]);
    expect(taskMocks.runValidate).toHaveBeenCalledWith(expect.objectContaining({ fix: true }));
  });

  it("leaves fix undefined when --fix is omitted", async () => {
    await runSer(["validate", "--quiet"]);
    expect(taskMocks.runValidate.mock.calls.at(-1)?.[0].fix).toBeUndefined();
  });
});

describe("serialization watch", () => {
  it("delegates to runWatch with the environment name", async () => {
    await runSer(["watch", "--environment-name", "demo", "--quiet"]);
    expect(taskMocks.runWatch).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "demo" })
    );
  });
});
