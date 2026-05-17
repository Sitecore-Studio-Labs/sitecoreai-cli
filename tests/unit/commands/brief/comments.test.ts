import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai ops brief comments …` command wiring. The brief comment task
 * runners are mocked; tests walk the command tree, then parse it the
 * way the CLI does to assert positional/option threading, the numeric
 * `--limit` coercion, the mandatory `--text` on `add`, the `--apply`
 * gate that forces `whatIf: true` on a bare `add`, and the default
 * (`list`) subcommand.
 */

const taskMocks = vi.hoisted(() => ({
  runBriefCommentAdd: vi.fn(),
  runBriefCommentsList: vi.fn(),
}));

vi.mock("../../../../src/brief/tasks", () => taskMocks);

import { createBriefCommentsCommand } from "../../../../src/commands/brief/comments";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

/** Render full help (including `addHelpText` after-blocks) to a string. */
const helpText = (command: Command): string => {
  let out = "";
  command.configureOutput({ writeOut: (s) => (out += s) });
  command.outputHelp();
  return out;
};

const runComments = async (args: string[]): Promise<void> => {
  const command = createBriefCommentsCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBriefCommentsCommand — command tree", () => {
  const comments = createBriefCommentsCommand();

  it("registers list and add subcommands", () => {
    expect(sub(comments, "list")).toBeDefined();
    expect(sub(comments, "add")).toBeDefined();
  });

  it("marks list as the default subcommand", () => {
    const list = sub(comments, "list")!;
    // Commander flags the default subcommand via _defaultCommandName.
    expect((comments as unknown as { _defaultCommandName?: string })._defaultCommandName).toBe(
      list.name()
    );
  });

  it("declares org-scope + config + verbosity flags on list", () => {
    const list = sub(comments, "list")!;
    const opts = new Set(list.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    for (const long of ["--org-id", "--environment-name", "--config", "--json", "--limit"]) {
      expect(opts.has(long), long).toBe(true);
    }
  });

  it("marks --text as a required option on add", () => {
    const add = sub(comments, "add")!;
    const required = add.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--text"]);
  });

  it("declares --apply and --what-if on add", () => {
    const add = sub(comments, "add")!;
    const opts = new Set(add.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    expect(opts.has("--apply")).toBe(true);
    expect(opts.has("--what-if")).toBe(true);
  });

  it("appends usage examples to the help text", () => {
    expect(helpText(comments)).toContain("Examples:");
  });
});

describe("brief comments list", () => {
  it("delegates to runBriefCommentsList with an undefined briefId for tenant-wide listing", async () => {
    await runComments(["list", "--quiet"]);
    expect(taskMocks.runBriefCommentsList).toHaveBeenCalledOnce();
    expect(taskMocks.runBriefCommentsList.mock.calls[0][0].briefId).toBeUndefined();
  });

  it("threads the optional [briefId] positional through", async () => {
    await runComments(["list", "brief-uuid-1", "--quiet"]);
    expect(taskMocks.runBriefCommentsList).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: "brief-uuid-1" })
    );
  });

  it("coerces --limit to a number", async () => {
    await runComments(["list", "--quiet", "--limit", "25"]);
    expect(taskMocks.runBriefCommentsList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 })
    );
  });

  it("threads --org-id and --environment-name through", async () => {
    await runComments(["list", "--quiet", "--org-id", "org_X", "--environment-name", "agents"]);
    expect(taskMocks.runBriefCommentsList).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org_X", environmentName: "agents" })
    );
  });

  it("runs list as the default subcommand when none is named", async () => {
    await runComments(["--quiet"]);
    expect(taskMocks.runBriefCommentsList).toHaveBeenCalledOnce();
  });
});

describe("brief comments add", () => {
  it("threads the briefId + --text and forces whatIf:true without --apply", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runComments(["add", "brief-1", "--text", "Looks good", "--quiet"]);
    expect(taskMocks.runBriefCommentAdd).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: "brief-1", text: "Looks good", whatIf: true })
    );
    expect(stderr).toHaveBeenCalled();
  });

  it("executes the write (no whatIf coercion) when --apply is passed", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runComments(["add", "brief-1", "--text", "Ship it", "--quiet", "--apply"]);
    const call = taskMocks.runBriefCommentAdd.mock.calls[0][0];
    expect(call).toMatchObject({ briefId: "brief-1", text: "Ship it", apply: true });
    expect(call.whatIf).toBeUndefined();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("rejects a missing required --text", async () => {
    await expect(runComments(["add", "brief-1", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runBriefCommentAdd).not.toHaveBeenCalled();
  });
});
