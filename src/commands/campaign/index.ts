import { Command, Option } from "commander";
import {
  runCampaignCreate,
  runCampaignDelete,
  runCampaignList,
  runCampaignGet,
  runCampaignUsers,
  runDeliverableCreate,
  runDeliverableDelete,
  runTaskCreate,
  runTaskDelete,
  runTaskList,
  runTaskGet,
  runTaskUpdate,
} from "@/campaigns/tasks";
import { confirmDestructive } from "@/shared/cli-tasks";
import { createCampaignSyncCommand } from "./sync";
import {
  addApplyOption,
  addConfigOption,
  addOrgScopeOptions,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";

/**
 * `scai ops campaign …` — Sitecore Orchestrate API surface.
 *
 * A campaign is an Orchestrate `project`; projects own deliverables,
 * deliverables own tasks. Read verbs are always available; write verbs
 * (`create`, `update`, `delete`) dry-run unless `--apply` is passed.
 *
 * `delete` verbs hit Orchestrate DELETE endpoints that were never
 * captured during reverse-engineering — they are wired optimistically
 * per REST conventions and marked UNVERIFIED. Smoke-test with
 * `scripts/_smoke-campaign-delete.ts` before relying on them.
 *
 *   scai ops campaign list
 *   scai ops campaign get <campaignId>
 *   scai ops campaign create --name "Spring Launch" --apply
 *   scai ops campaign delete <campaignId> --apply --force
 *   scai ops campaign users
 *   scai ops campaign deliverable create|delete <campaignId> …
 *   scai ops campaign task list|get|create|update|delete …
 */

const createListCommand = (): Command => {
  const command = new Command("list").description("List campaigns in the tenant.");
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--limit <n>", "Page size").argParser(Number));
  command.addOption(
    new Option(
      "--lean",
      "Emit only identity + linkage fields (id, name, labels, brandkit_id, status) as compact JSON. Drops the heavy deliverables/members/attachments bodies. --json only."
    )
  );
  command.action(async (options) => {
    await runCampaignList(options);
  });
  return command;
};

const createGetCommand = (): Command => {
  const command = new Command("get")
    .description("Get a campaign with its deliverables and tasks.")
    .argument("<campaignId>", "Campaign (project) UUID");
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (campaignId, options) => {
    await runCampaignGet({ ...options, campaignId });
  });
  return command;
};

const createUsersCommand = (): Command => {
  const command = new Command("users").description(
    "List users available as campaign members / task assignees."
  );
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options) => {
    await runCampaignUsers(options);
  });
  return command;
};

const createCreateCommand = (): Command => {
  const command = new Command("create")
    .description("Create a campaign. Requires --apply.")
    .requiredOption("--name <name>", "Campaign name")
    .option("--description <text>", "Campaign description")
    .option("--start-date <iso>", "Start date (ISO-8601)")
    .option("--due-date <iso>", "Due date (ISO-8601)")
    .option("--brandkit-id <id>", "Associated brand kit UUID")
    .option("--status <status>", "Initial status", "NOT_STARTED");
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(
    withApplyGate(
      async (options: {
        name: string;
        description?: string;
        startDate?: string;
        dueDate?: string;
        brandkitId?: string;
        status?: string;
        apply?: boolean;
        whatIf?: boolean;
      }) => {
        await runCampaignCreate({
          ...options,
          input: {
            name: options.name,
            description: options.description,
            start_date: options.startDate,
            due_date: options.dueDate,
            brandkit_id: options.brandkitId,
            status: options.status,
          },
        });
      }
    )
  );
  return command;
};

const createDeleteCommand = (): Command => {
  const command = new Command("delete")
    .description(
      "Delete a campaign. UNVERIFIED — the Orchestrate DELETE endpoint was never " +
        "captured; inferred from REST conventions. Requires --apply; non-TTY callers " +
        "must also pass --force."
    )
    .argument("<campaignId>", "Campaign (project) UUID")
    .addOption(
      new Option("--force", "Skip TTY confirmation prompt (required for non-TTY agents).")
    );
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(async (campaignId, options) => {
    await withApplyGate(async (opts: { force?: boolean; apply?: boolean; whatIf?: boolean }) => {
      if (!opts.whatIf) {
        const confirmed = await confirmDestructive(
          `Delete campaign ${campaignId}? This cannot be undone.`,
          opts.force
        );
        if (!confirmed) {
          process.stderr.write("Aborted.\n");
          return;
        }
      }
      await runCampaignDelete({ ...opts, campaignId });
    })(options);
  });
  return command;
};

const createDeliverableCommand = (): Command => {
  const deliverable = new Command("deliverable").description("Deliverable operations.");

  const create = new Command("create")
    .description("Create a deliverable under a campaign. Requires --apply.")
    .argument("<campaignId>", "Campaign (project) UUID")
    .requiredOption("--name <name>", "Deliverable name")
    .option("--due-date <iso>", "Due date (ISO-8601)")
    .option("--funnel-stage <stage>", "Funnel stage, e.g. TOP")
    .option("--funnel-tactics <csv>", "Comma-separated funnel tactics")
    .option("--status <status>", "Initial status", "NOT_STARTED");
  addOrgScopeOptions(create);
  addConfigOption(create);
  addVerbosityOptions(create);
  addApplyOption(create);
  addWhatIfOption(create);
  create.action(async (campaignId, options) => {
    await withApplyGate(
      async (opts: {
        name: string;
        dueDate?: string;
        funnelStage?: string;
        funnelTactics?: string;
        status?: string;
        apply?: boolean;
        whatIf?: boolean;
      }) => {
        await runDeliverableCreate({
          ...opts,
          campaignId,
          input: {
            name: opts.name,
            due_date: opts.dueDate,
            funnel_stage: opts.funnelStage,
            funnel_tactics: opts.funnelTactics
              ? opts.funnelTactics.split(",").map((t) => t.trim())
              : undefined,
            status: opts.status,
          },
        });
      }
    )(options);
  });

  const remove = new Command("delete")
    .description(
      "Delete a deliverable under a campaign. UNVERIFIED — the Orchestrate DELETE " +
        "endpoint was never captured; inferred from REST conventions. Requires --apply; " +
        "non-TTY callers must also pass --force."
    )
    .argument("<campaignId>", "Campaign (project) UUID")
    .argument("<deliverableId>", "Deliverable UUID")
    .addOption(
      new Option("--force", "Skip TTY confirmation prompt (required for non-TTY agents).")
    );
  addOrgScopeOptions(remove);
  addConfigOption(remove);
  addVerbosityOptions(remove);
  addApplyOption(remove);
  addWhatIfOption(remove);
  remove.action(async (campaignId, deliverableId, options) => {
    await withApplyGate(async (opts: { force?: boolean; apply?: boolean; whatIf?: boolean }) => {
      if (!opts.whatIf) {
        const confirmed = await confirmDestructive(
          `Delete deliverable ${deliverableId}? This cannot be undone.`,
          opts.force
        );
        if (!confirmed) {
          process.stderr.write("Aborted.\n");
          return;
        }
      }
      await runDeliverableDelete({ ...opts, campaignId, deliverableId });
    })(options);
  });

  deliverable.addCommand(create);
  deliverable.addCommand(remove);
  return deliverable;
};

const createTaskCommand = (): Command => {
  const task = new Command("task").description("Task operations.");

  const list = new Command("list")
    .description("List tasks under a deliverable.")
    .argument("<campaignId>", "Campaign UUID")
    .argument("<deliverableId>", "Deliverable UUID");
  addOrgScopeOptions(list);
  addConfigOption(list);
  addVerbosityOptions(list);
  list.action(async (campaignId, deliverableId, options) => {
    await runTaskList({ ...options, campaignId, deliverableId });
  });

  const get = new Command("get")
    .description("Get one task.")
    .argument("<campaignId>", "Campaign UUID")
    .argument("<deliverableId>", "Deliverable UUID")
    .argument("<taskId>", "Task UUID");
  addOrgScopeOptions(get);
  addConfigOption(get);
  addVerbosityOptions(get);
  get.action(async (campaignId, deliverableId, taskId, options) => {
    await runTaskGet({ ...options, campaignId, deliverableId, taskId });
  });

  const create = new Command("create")
    .description("Create a task under a deliverable. Requires --apply.")
    .argument("<campaignId>", "Campaign UUID")
    .argument("<deliverableId>", "Deliverable UUID")
    .requiredOption("--name <name>", "Task name")
    .option("--due-date <iso>", "Due date (ISO-8601)")
    .option("--status <status>", "Initial status", "NOT_STARTED");
  addOrgScopeOptions(create);
  addConfigOption(create);
  addVerbosityOptions(create);
  addApplyOption(create);
  addWhatIfOption(create);
  create.action(async (campaignId, deliverableId, options) => {
    await withApplyGate(
      async (opts: {
        name: string;
        dueDate?: string;
        status?: string;
        apply?: boolean;
        whatIf?: boolean;
      }) => {
        await runTaskCreate({
          ...opts,
          campaignId,
          deliverableId,
          input: { name: opts.name, due_date: opts.dueDate, status: opts.status },
        });
      }
    )(options);
  });

  const update = new Command("update")
    .description("Replace a task via PUT (full-replacement). Requires --apply.")
    .argument("<campaignId>", "Campaign UUID")
    .argument("<deliverableId>", "Deliverable UUID")
    .argument("<taskId>", "Task UUID")
    .requiredOption("--name <name>", "Task name")
    .option("--due-date <iso>", "Due date (ISO-8601)")
    .option("--status <status>", "Status")
    .option("--priority <priority>", "Priority")
    .option("--description <html>", "Description (HTML)")
    .option("--assignee <userId>", "Assignee — an Auth0 subject");
  addOrgScopeOptions(update);
  addConfigOption(update);
  addVerbosityOptions(update);
  addApplyOption(update);
  addWhatIfOption(update);
  update.action(async (campaignId, deliverableId, taskId, options) => {
    await withApplyGate(
      async (opts: {
        name: string;
        dueDate?: string;
        status?: string;
        priority?: string;
        description?: string;
        assignee?: string;
        apply?: boolean;
        whatIf?: boolean;
      }) => {
        await runTaskUpdate({
          ...opts,
          campaignId,
          deliverableId,
          taskId,
          input: {
            name: opts.name,
            due_date: opts.dueDate,
            status: opts.status,
            priority: opts.priority,
            description: opts.description,
            assignee: opts.assignee,
          },
        });
      }
    )(options);
  });

  const remove = new Command("delete")
    .description(
      "Delete a task under a deliverable. UNVERIFIED — the Orchestrate DELETE " +
        "endpoint was never captured; inferred from REST conventions. Requires --apply; " +
        "non-TTY callers must also pass --force."
    )
    .argument("<campaignId>", "Campaign UUID")
    .argument("<deliverableId>", "Deliverable UUID")
    .argument("<taskId>", "Task UUID")
    .addOption(
      new Option("--force", "Skip TTY confirmation prompt (required for non-TTY agents).")
    );
  addOrgScopeOptions(remove);
  addConfigOption(remove);
  addVerbosityOptions(remove);
  addApplyOption(remove);
  addWhatIfOption(remove);
  remove.action(async (campaignId, deliverableId, taskId, options) => {
    await withApplyGate(async (opts: { force?: boolean; apply?: boolean; whatIf?: boolean }) => {
      if (!opts.whatIf) {
        const confirmed = await confirmDestructive(
          `Delete task ${taskId}? This cannot be undone.`,
          opts.force
        );
        if (!confirmed) {
          process.stderr.write("Aborted.\n");
          return;
        }
      }
      await runTaskDelete({ ...opts, campaignId, deliverableId, taskId });
    })(options);
  });

  task.addCommand(list);
  task.addCommand(get);
  task.addCommand(create);
  task.addCommand(update);
  task.addCommand(remove);
  return task;
};

export const createCampaignCommand = (): Command => {
  const command = new Command("campaign").description(
    "Sitecore Orchestrate campaigns — projects, deliverables, and tasks."
  );

  command.addCommand(createListCommand());
  command.addCommand(createGetCommand());
  command.addCommand(createCreateCommand());
  command.addCommand(createDeleteCommand());
  command.addCommand(createUsersCommand());
  command.addCommand(createDeliverableCommand());
  command.addCommand(createTaskCommand());
  command.addCommand(createCampaignSyncCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai ops campaign list -n agents\n" +
      "  $ scai ops campaign get <campaignId> -n agents\n" +
      "  $ scai ops campaign create --name 'Spring Launch' --apply -n agents\n" +
      "  $ scai ops campaign delete <campaignId> --apply --force   # UNVERIFIED endpoint\n" +
      "  $ scai ops campaign deliverable create <campaignId> --name 'Landing page' --apply\n" +
      "  $ scai ops campaign deliverable delete <campaignId> <deliverableId> --apply --force\n" +
      "  $ scai ops campaign task create <campaignId> <deliverableId> --name 'Draft copy' --apply\n" +
      "  $ scai ops campaign task delete <campaignId> <deliverableId> <taskId> --apply --force\n"
  );

  return command;
};
