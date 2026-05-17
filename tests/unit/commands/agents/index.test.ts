import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { createAgentsCommand } from "../../../../src/commands/agents";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

/** Names of a command's direct subcommands. */
const subNames = (command: Command): string[] => command.commands.map((child) => child.name());

/** Whether a command declares a `--long` option. */
const hasOption = (command: Command, long: string): boolean =>
  command.options.some((option) => option.long === long);

describe("createAgentsCommand", () => {
  const agents = createAgentsCommand();

  it("groups every Agentic Studio resource under its own subcommand", () => {
    const groups = ["agent", "space", "skill", "widget", "schema", "mcp", "html-template", "tool"];
    for (const group of groups) {
      expect(sub(agents, group), `missing \`${group}\` group`).toBeDefined();
    }
  });

  it("gives `space` read + config-update (no list/create/delete — the API has none)", () => {
    const space = sub(agents, "space")!;
    expect(subNames(space)).toEqual(expect.arrayContaining(["get", "artifacts", "update"]));
    expect(sub(space, "list")).toBeUndefined();
    expect(sub(space, "create")).toBeUndefined();
    expect(sub(space, "delete")).toBeUndefined();
  });

  it("keeps session management and the declarative sync path", () => {
    for (const name of ["login", "logout", "status", "sync"]) {
      expect(sub(agents, name)).toBeDefined();
    }
  });

  it("gives `agent` full, verified CRUD with no --unverified gate", () => {
    const agent = sub(agents, "agent")!;
    expect(subNames(agent)).toEqual(
      expect.arrayContaining(["list", "get", "create", "update", "delete", "duplicate", "run"])
    );
    expect(hasOption(sub(agent, "update")!, "--unverified")).toBe(false);
    expect(hasOption(sub(agent, "delete")!, "--unverified")).toBe(false);
  });

  it("uses `delete`, not `rm`, as the agent delete verb", () => {
    const agent = sub(agents, "agent")!;
    expect(sub(agent, "delete")).toBeDefined();
    expect(sub(agent, "rm")).toBeUndefined();
  });

  it("gives every non-agent resource list/get/create/update/delete", () => {
    for (const group of ["skill", "widget", "schema", "mcp", "html-template"]) {
      expect(subNames(sub(agents, group)!), group).toEqual(
        expect.arrayContaining(["list", "get", "create", "update", "delete"])
      );
    }
  });

  it("gates only the UNVERIFIED writes behind --unverified (per the 2026-05-17 probe)", () => {
    // [resource, update gated?, delete gated?] — verified writes are ungated.
    const matrix: [string, boolean, boolean][] = [
      ["skill", false, false],
      ["widget", false, false],
      ["schema", false, true],
      ["mcp", true, false],
      ["html-template", true, true],
    ];
    for (const [group, updateGated, deleteGated] of matrix) {
      const resource = sub(agents, group)!;
      expect(hasOption(sub(resource, "update")!, "--unverified"), `${group} update`).toBe(
        updateGated
      );
      expect(hasOption(sub(resource, "delete")!, "--unverified"), `${group} delete`).toBe(
        deleteGated
      );
    }
  });

  it("surfaces an html-template `list` — the read that was previously missing", () => {
    expect(sub(sub(agents, "html-template")!, "list")).toBeDefined();
  });

  it("keeps `tool` read-only — a list, with no write subcommands", () => {
    const tool = sub(agents, "tool")!;
    expect(subNames(tool)).toContain("list");
    expect(subNames(tool)).not.toContain("create");
    expect(subNames(tool)).not.toContain("delete");
  });

  it("drops the old flat commands entirely (no aliases)", () => {
    for (const removed of ["list", "skills", "tools", "widgets", "schemas", "mcps", "run", "rm"]) {
      expect(sub(agents, removed), `\`agents ${removed}\` should no longer exist`).toBeUndefined();
    }
  });
});
