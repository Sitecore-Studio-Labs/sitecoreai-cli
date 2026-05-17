import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai agents …` command wiring. The structural describe block needs no
 * mocks — it just walks the command tree. The delegation block mocks the
 * `@/agents/tasks` runner set: the `updateVerified` / `deleteVerified`
 * flags are kept faithful to the 2026-05-17 probe so the `--unverified`
 * gate behaves as in production, and tests assert positional-argument
 * threading, the apply gate, and the destructive-delete confirmation.
 */

const agentRunners = vi.hoisted(() => ({
  runAgentList: vi.fn(),
  runAgentGet: vi.fn(),
  runAgentCreate: vi.fn(),
  runAgentUpdate: vi.fn(),
  runAgentDuplicate: vi.fn(),
  runAgentDelete: vi.fn(),
  runAgentRun: vi.fn(),
  runAgentsLogin: vi.fn(),
  runAgentsLogout: vi.fn(),
  runAgentsStatus: vi.fn(),
  runSpaceGet: vi.fn(),
  runSpaceArtifacts: vi.fn(),
  runSpaceUpdate: vi.fn(),
  runToolList: vi.fn(),
}));

const resourceTasks = vi.hoisted(() => {
  const mk = (u: boolean, d: boolean) => ({
    updateVerified: u,
    deleteVerified: d,
    runList: vi.fn(),
    runGet: vi.fn(),
    runCreate: vi.fn(),
    runUpdate: vi.fn(),
    runDelete: vi.fn(),
  });
  return {
    skillTasks: mk(true, true),
    widgetTasks: mk(true, true),
    schemaTasks: mk(true, false),
    mcpTasks: mk(false, true),
    htmlTemplateTasks: mk(false, false),
  };
});

vi.mock("../../../../src/agents/tasks", () => ({
  ...agentRunners,
  ...resourceTasks,
  requireUnverified: vi.fn(),
}));

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

describe("createAgentsCommand — action delegation", () => {
  const runAgents = async (args: string[]): Promise<void> => {
    const command = createAgentsCommand();
    command.exitOverride();
    await command.parseAsync(["node", "scai", ...args]);
  };

  beforeEach(() => {
    for (const m of Object.values(agentRunners)) m.mockReset().mockResolvedValue(undefined);
    for (const tasks of Object.values(resourceTasks)) {
      for (const v of Object.values(tasks)) {
        if (typeof v === "function" && "mockReset" in v) v.mockReset().mockResolvedValue(undefined);
      }
    }
    // Silence the "Aborted." stderr write some destructive paths emit.
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("threads the <idOrSlug> positional into `agent get`", async () => {
    await runAgents(["agent", "get", "research", "--quiet"]);
    expect(agentRunners.runAgentGet).toHaveBeenCalledWith(
      expect.objectContaining({ idOrSlug: "research" })
    );
  });

  it("dry-runs `agent create` without --apply (whatIf coerced true)", async () => {
    await runAgents(["agent", "create", "-f", "research.agent.yaml", "--quiet"]);
    expect(agentRunners.runAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ file: "research.agent.yaml", whatIf: true })
    );
  });

  it("applies `agent create` when --apply is set", async () => {
    await runAgents(["agent", "create", "-f", "research.agent.yaml", "--apply", "--quiet"]);
    const call = agentRunners.runAgentCreate.mock.calls.at(-1)?.[0];
    expect(call.apply).toBe(true);
    expect(call.whatIf).toBeUndefined();
  });

  it("threads the agent slug + --message into `agent run`", async () => {
    await runAgents(["agent", "run", "research", "-m", "Summarize", "--quiet"]);
    expect(agentRunners.runAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentSlug: "research", message: "Summarize" })
    );
  });

  it("deletes an agent when --apply + --force are set", async () => {
    await runAgents(["agent", "delete", "research", "--apply", "--force", "--quiet"]);
    expect(agentRunners.runAgentDelete).toHaveBeenCalledWith(
      expect.objectContaining({ idOrSlug: "research" })
    );
  });

  it("delegates an `agent delete` dry-run to the runner with whatIf=true (no confirm prompt)", async () => {
    // No --apply → withApplyGate coerces whatIf=true; the destructive
    // confirmDestructive prompt is skipped and the runner dry-runs itself.
    await runAgents(["agent", "delete", "research", "--quiet"]);
    expect(agentRunners.runAgentDelete).toHaveBeenCalledWith(
      expect.objectContaining({ idOrSlug: "research", whatIf: true })
    );
  });

  it("throws INPUT_INVALID on a non-TTY `agent delete --apply` without --force", async () => {
    await expect(
      runAgents(["agent", "delete", "research", "--apply", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(agentRunners.runAgentDelete).not.toHaveBeenCalled();
  });

  it("threads the <spaceId> positional into `space artifacts`", async () => {
    await runAgents(["space", "artifacts", "space-1", "--quiet"]);
    expect(agentRunners.runSpaceArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-1" })
    );
  });

  it("delegates `tool list` to the read-only runner", async () => {
    await runAgents(["tool", "list", "--quiet"]);
    expect(agentRunners.runToolList).toHaveBeenCalledOnce();
  });

  it("delegates a verified `skill update` to the resource runner under --apply", async () => {
    await runAgents(["skill", "update", "skill-1", "-f", "s.yaml", "--apply", "--quiet"]);
    expect(resourceTasks.skillTasks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "skill-1", file: "s.yaml" })
    );
  });

  it("delegates `login`, threading an explicit --region", async () => {
    await runAgents(["login", "--region", "euw", "--quiet"]);
    expect(agentRunners.runAgentsLogin).toHaveBeenCalledWith(
      expect.objectContaining({ region: "euw" })
    );
  });

  it("delegates `logout` to the session runner", async () => {
    await runAgents(["logout", "--quiet"]);
    expect(agentRunners.runAgentsLogout).toHaveBeenCalledOnce();
  });

  it("delegates `status` to the session runner", async () => {
    await runAgents(["status", "--quiet"]);
    expect(agentRunners.runAgentsStatus).toHaveBeenCalledOnce();
  });

  it("delegates the default `agent list` subcommand", async () => {
    await runAgents(["agent", "list", "--quiet"]);
    expect(agentRunners.runAgentList).toHaveBeenCalledOnce();
  });

  it("threads <idOrSlug> + --file into `agent update` under --apply", async () => {
    await runAgents([
      "agent",
      "update",
      "research",
      "-f",
      "research.agent.yaml",
      "--apply",
      "--quiet",
    ]);
    expect(agentRunners.runAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ idOrSlug: "research", file: "research.agent.yaml", apply: true })
    );
  });

  it("dry-runs `agent update` without --apply (whatIf coerced true)", async () => {
    await runAgents(["agent", "update", "research", "-f", "r.yaml", "--quiet"]);
    expect(agentRunners.runAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ idOrSlug: "research", whatIf: true })
    );
  });

  it("threads <idOrSlug> + --name into `agent duplicate` under --apply", async () => {
    await runAgents([
      "agent",
      "duplicate",
      "research",
      "--name",
      "research-copy",
      "--apply",
      "--quiet",
    ]);
    expect(agentRunners.runAgentDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ idOrSlug: "research", name: "research-copy" })
    );
  });

  it("threads the <spaceId> positional into `space get`", async () => {
    await runAgents(["space", "get", "space-7", "--quiet"]);
    expect(agentRunners.runSpaceGet).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-7" })
    );
  });

  it("threads <spaceId> + --file into `space update` under --apply", async () => {
    await runAgents(["space", "update", "space-7", "-f", "patch.json", "--apply", "--quiet"]);
    expect(agentRunners.runSpaceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-7", file: "patch.json" })
    );
  });

  it("delegates `skill list` to the resource runner", async () => {
    await runAgents(["skill", "list", "--quiet"]);
    expect(resourceTasks.skillTasks.runList).toHaveBeenCalledOnce();
  });

  it("threads <idOrName> into `skill get`", async () => {
    await runAgents(["skill", "get", "skill-1", "--quiet"]);
    expect(resourceTasks.skillTasks.runGet).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "skill-1" })
    );
  });

  it("dry-runs `skill create` without --apply (whatIf coerced true)", async () => {
    await runAgents(["skill", "create", "-f", "s.yaml", "--quiet"]);
    expect(resourceTasks.skillTasks.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ file: "s.yaml", whatIf: true })
    );
  });

  it("deletes a verified resource (skill) under --apply --force", async () => {
    await runAgents(["skill", "delete", "skill-1", "--apply", "--force", "--quiet"]);
    expect(resourceTasks.skillTasks.runDelete).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "skill-1" })
    );
  });

  it("dry-runs an UNVERIFIED `schema delete` without prompting (whatIf, no --unverified needed)", async () => {
    // No --apply → whatIf=true; the runner itself enforces the unverified
    // gate, so the command-level requireUnverified is skipped on a dry run.
    await runAgents(["schema", "delete", "schema-1", "--quiet"]);
    expect(resourceTasks.schemaTasks.runDelete).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "schema-1", whatIf: true })
    );
  });

  it("calls requireUnverified before deleting an UNVERIFIED resource under --apply", async () => {
    const { requireUnverified } = await import("../../../../src/agents/tasks");
    await runAgents([
      "schema",
      "delete",
      "schema-1",
      "--apply",
      "--force",
      "--unverified",
      "--quiet",
    ]);
    expect(requireUnverified).toHaveBeenCalledWith(true, "schema", "delete");
    expect(resourceTasks.schemaTasks.runDelete).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "schema-1" })
    );
  });

  it("threads <idOrName> + --file into an UNVERIFIED `mcp update` under --apply", async () => {
    await runAgents([
      "mcp",
      "update",
      "mcp-1",
      "-f",
      "m.yaml",
      "--unverified",
      "--apply",
      "--quiet",
    ]);
    expect(resourceTasks.mcpTasks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "mcp-1", file: "m.yaml", unverified: true })
    );
  });
});
