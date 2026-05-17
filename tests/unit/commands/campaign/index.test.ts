import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai ops campaign …` command wiring. The Orchestrate task runners are
 * mocked; tests assert the command-tree shape, numeric `--limit`
 * coercion, the apply-gate on writes, the funnel-tactics CSV split, the
 * snake_case input mapping, and the destructive-delete confirmation.
 */

const taskMocks = vi.hoisted(() => ({
  runCampaignCreate: vi.fn(),
  runCampaignDelete: vi.fn(),
  runCampaignList: vi.fn(),
  runCampaignShow: vi.fn(),
  runCampaignUsers: vi.fn(),
  runDeliverableCreate: vi.fn(),
  runDeliverableDelete: vi.fn(),
  runTaskCreate: vi.fn(),
  runTaskDelete: vi.fn(),
  runTaskList: vi.fn(),
  runTaskShow: vi.fn(),
  runTaskUpdate: vi.fn(),
}));

vi.mock("../../../../src/campaigns/tasks", () => taskMocks);

import { createCampaignCommand } from "../../../../src/commands/campaign";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runCampaign = async (args: string[]): Promise<void> => {
  const command = createCampaignCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
  // Silence the "Aborted." stderr write some destructive paths emit.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCampaignCommand — command tree", () => {
  const campaign = createCampaignCommand();

  it("registers the top-level verbs and the sync path", () => {
    for (const name of [
      "list",
      "show",
      "create",
      "delete",
      "users",
      "deliverable",
      "task",
      "sync",
    ]) {
      expect(sub(campaign, name), name).toBeDefined();
    }
  });

  it("gives deliverable create + delete", () => {
    const deliverable = sub(campaign, "deliverable")!;
    expect(sub(deliverable, "create")).toBeDefined();
    expect(sub(deliverable, "delete")).toBeDefined();
  });

  it("gives task list/show/create/update/delete", () => {
    const task = sub(campaign, "task")!;
    for (const name of ["list", "show", "create", "update", "delete"]) {
      expect(sub(task, name), name).toBeDefined();
    }
  });
});

describe("campaign list", () => {
  it("coerces --limit to a number before delegating", async () => {
    await runCampaign(["list", "--limit", "25", "--quiet"]);
    expect(taskMocks.runCampaignList).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
  });

  it("delegates with no limit when the flag is omitted", async () => {
    await runCampaign(["list", "--quiet"]);
    const call = taskMocks.runCampaignList.mock.calls.at(-1)?.[0];
    expect(call.limit).toBeUndefined();
  });
});

describe("campaign show", () => {
  it("threads the positional campaignId into the runner options", async () => {
    await runCampaign(["show", "camp-1", "--quiet"]);
    expect(taskMocks.runCampaignShow).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1" })
    );
  });
});

describe("campaign create — apply gate + input mapping", () => {
  it("dry-runs (whatIf coerced true) without --apply", async () => {
    await runCampaign(["create", "--name", "Spring", "--quiet"]);
    expect(taskMocks.runCampaignCreate).toHaveBeenCalledWith(
      expect.objectContaining({ whatIf: true })
    );
  });

  it("maps camelCase flags to a snake_case input and applies with --apply", async () => {
    await runCampaign([
      "create",
      "--name",
      "Spring",
      "--description",
      "d",
      "--start-date",
      "2026-01-01",
      "--due-date",
      "2026-02-01",
      "--brandkit-id",
      "kit-1",
      "--apply",
      "--quiet",
    ]);
    expect(taskMocks.runCampaignCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        apply: true,
        input: {
          name: "Spring",
          description: "d",
          start_date: "2026-01-01",
          due_date: "2026-02-01",
          brandkit_id: "kit-1",
          status: "NOT_STARTED",
        },
      })
    );
  });
});

describe("campaign delete — destructive gate", () => {
  it("deletes when --apply and --force are both set", async () => {
    await runCampaign(["delete", "camp-1", "--apply", "--force", "--quiet"]);
    expect(taskMocks.runCampaignDelete).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1" })
    );
  });

  it("delegates a dry-run delete with whatIf=true (no confirm prompt)", async () => {
    // No --apply → withApplyGate coerces whatIf=true; the confirmDestructive
    // prompt is skipped and runCampaignDelete dry-runs itself.
    await runCampaign(["delete", "camp-1", "--quiet"]);
    expect(taskMocks.runCampaignDelete).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1", whatIf: true })
    );
  });

  it("throws INPUT_INVALID with --apply but no --force in a non-TTY shell", async () => {
    await expect(runCampaign(["delete", "camp-1", "--apply", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(taskMocks.runCampaignDelete).not.toHaveBeenCalled();
  });
});

describe("campaign deliverable create — funnel-tactics CSV", () => {
  it("splits comma-separated --funnel-tactics into a trimmed array", async () => {
    await runCampaign([
      "deliverable",
      "create",
      "camp-1",
      "--name",
      "Landing page",
      "--funnel-stage",
      "TOP",
      "--funnel-tactics",
      "seo, paid , social",
      "--apply",
      "--quiet",
    ]);
    expect(taskMocks.runDeliverableCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp-1",
        input: expect.objectContaining({
          name: "Landing page",
          funnel_stage: "TOP",
          funnel_tactics: ["seo", "paid", "social"],
        }),
      })
    );
  });

  it("leaves funnel_tactics undefined when the flag is omitted", async () => {
    await runCampaign([
      "deliverable",
      "create",
      "camp-1",
      "--name",
      "Landing page",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runDeliverableCreate.mock.calls.at(-1)?.[0];
    expect(call.input.funnel_tactics).toBeUndefined();
  });
});

describe("campaign task verbs", () => {
  it("threads all three positionals into runTaskShow", async () => {
    await runCampaign(["task", "show", "camp-1", "del-1", "task-1", "--quiet"]);
    expect(taskMocks.runTaskShow).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1", deliverableId: "del-1", taskId: "task-1" })
    );
  });

  it("maps task update flags into a snake_case input under --apply", async () => {
    await runCampaign([
      "task",
      "update",
      "camp-1",
      "del-1",
      "task-1",
      "--name",
      "Draft copy",
      "--due-date",
      "2026-03-01",
      "--assignee",
      "auth0|abc",
      "--apply",
      "--quiet",
    ]);
    expect(taskMocks.runTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        input: expect.objectContaining({
          name: "Draft copy",
          due_date: "2026-03-01",
          assignee: "auth0|abc",
        }),
      })
    );
  });

  it("requires --apply + --force for a non-TTY task delete", async () => {
    await expect(
      runCampaign(["task", "delete", "camp-1", "del-1", "task-1", "--apply", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(taskMocks.runTaskDelete).not.toHaveBeenCalled();
  });

  it("threads both positionals into runTaskList", async () => {
    await runCampaign(["task", "list", "camp-1", "del-1", "--quiet"]);
    expect(taskMocks.runTaskList).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1", deliverableId: "del-1" })
    );
  });

  it("dry-runs `task create` without --apply (whatIf coerced true)", async () => {
    await runCampaign(["task", "create", "camp-1", "del-1", "--name", "Draft copy", "--quiet"]);
    expect(taskMocks.runTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        whatIf: true,
        campaignId: "camp-1",
        deliverableId: "del-1",
        input: expect.objectContaining({ name: "Draft copy", status: "NOT_STARTED" }),
      })
    );
  });

  it("maps task create flags into a snake_case input under --apply", async () => {
    await runCampaign([
      "task",
      "create",
      "camp-1",
      "del-1",
      "--name",
      "Draft copy",
      "--due-date",
      "2026-04-01",
      "--status",
      "IN_PROGRESS",
      "--apply",
      "--quiet",
    ]);
    expect(taskMocks.runTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        apply: true,
        input: { name: "Draft copy", due_date: "2026-04-01", status: "IN_PROGRESS" },
      })
    );
  });

  it("maps every task update flag into the snake_case input", async () => {
    await runCampaign([
      "task",
      "update",
      "camp-1",
      "del-1",
      "task-1",
      "--name",
      "Final copy",
      "--priority",
      "HIGH",
      "--description",
      "<p>body</p>",
      "--apply",
      "--quiet",
    ]);
    expect(taskMocks.runTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          name: "Final copy",
          priority: "HIGH",
          description: "<p>body</p>",
        }),
      })
    );
  });

  it("dry-runs `task delete` without --apply (whatIf=true, no confirm prompt)", async () => {
    await runCampaign(["task", "delete", "camp-1", "del-1", "task-1", "--quiet"]);
    expect(taskMocks.runTaskDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp-1",
        deliverableId: "del-1",
        taskId: "task-1",
        whatIf: true,
      })
    );
  });

  it("deletes a task when --apply + --force are both set", async () => {
    await runCampaign([
      "task",
      "delete",
      "camp-1",
      "del-1",
      "task-1",
      "--apply",
      "--force",
      "--quiet",
    ]);
    expect(taskMocks.runTaskDelete).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1", deliverableId: "del-1", taskId: "task-1" })
    );
  });
});

describe("campaign users", () => {
  it("delegates to runCampaignUsers with the parsed option bag", async () => {
    await runCampaign(["users", "--quiet"]);
    expect(taskMocks.runCampaignUsers).toHaveBeenCalledOnce();
    expect(taskMocks.runCampaignUsers.mock.calls[0][0]).toMatchObject({ quiet: true });
  });
});

describe("campaign deliverable delete — destructive gate", () => {
  it("dry-runs without --apply (whatIf=true, no confirm prompt)", async () => {
    await runCampaign(["deliverable", "delete", "camp-1", "del-1", "--quiet"]);
    expect(taskMocks.runDeliverableDelete).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1", deliverableId: "del-1", whatIf: true })
    );
  });

  it("deletes when --apply + --force are both set", async () => {
    await runCampaign([
      "deliverable",
      "delete",
      "camp-1",
      "del-1",
      "--apply",
      "--force",
      "--quiet",
    ]);
    expect(taskMocks.runDeliverableDelete).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1", deliverableId: "del-1" })
    );
  });

  it("throws INPUT_INVALID with --apply but no --force in a non-TTY shell", async () => {
    await expect(
      runCampaign(["deliverable", "delete", "camp-1", "del-1", "--apply", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(taskMocks.runDeliverableDelete).not.toHaveBeenCalled();
  });
});

describe("campaign deliverable create — dry run + status default", () => {
  it("dry-runs without --apply (whatIf coerced true)", async () => {
    await runCampaign(["deliverable", "create", "camp-1", "--name", "Landing page", "--quiet"]);
    expect(taskMocks.runDeliverableCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        whatIf: true,
        input: expect.objectContaining({ name: "Landing page", status: "NOT_STARTED" }),
      })
    );
  });

  it("threads --due-date into the snake_case input", async () => {
    await runCampaign([
      "deliverable",
      "create",
      "camp-1",
      "--name",
      "Landing page",
      "--due-date",
      "2026-05-01",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runDeliverableCreate.mock.calls.at(-1)?.[0];
    expect(call.input.due_date).toBe("2026-05-01");
  });
});
