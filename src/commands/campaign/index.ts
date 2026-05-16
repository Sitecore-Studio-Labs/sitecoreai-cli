import { Command, Option } from "commander";
import {
  runCampaignCreate,
  runCampaignList,
  runCampaignShow,
  runCampaignUsers,
  runDeliverableCreate,
  runTaskCreate,
  runTaskList,
  runTaskShow,
  runTaskUpdate,
} from "@/campaigns/tasks";
import { createCampaignSyncCommand } from "./sync";
import {
  addApplyOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";

/**
 * `scai ops campaign …` — Sitecore Orchestrate API surface.
 *
 * A campaign is an Orchestrate `project`; projects own deliverables,
 * deliverables own tasks. Read verbs are always available; write verbs
 * (`create`, `update`) dry-run unless `--apply` is passed.
 *
 *   scai ops campaign list
 *   scai ops campaign show <campaignId>
 *   scai ops campaign create --name "Spring Launch" --apply
 *   scai ops campaign users
 *   scai ops campaign deliverable create <campaignId> --name … --apply
 *   scai ops campaign task list|show|create|update …
 */

const createListCommand = (): Command => {
  const command = new Command("list").description("List campaigns in the tenant.");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--limit <n>", "Page size").argParser(Number));
  command.action(async (options) => {
    await runCampaignList(options);
  });
  return command;
};

const createShowCommand = (): Command => {
  const command = new Command("show")
    .description("Show a campaign with its deliverables and tasks.")
    .argument("<campaignId>", "Campaign (project) UUID");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (campaignId, options) => {
    await runCampaignShow({ ...options, campaignId });
  });
  return command;
};

const createUsersCommand = (): Command => {
  const command = new Command("users").description(
    "List users available as campaign members / task assignees."
  );
  addEnvironmentOption(command);
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
  addEnvironmentOption(command);
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
  addEnvironmentOption(create);
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

  deliverable.addCommand(create);
  return deliverable;
};

const createTaskCommand = (): Command => {
  const task = new Command("task").description("Task operations.");

  const list = new Command("list")
    .description("List tasks under a deliverable.")
    .argument("<campaignId>", "Campaign UUID")
    .argument("<deliverableId>", "Deliverable UUID");
  addEnvironmentOption(list);
  addConfigOption(list);
  addVerbosityOptions(list);
  list.action(async (campaignId, deliverableId, options) => {
    await runTaskList({ ...options, campaignId, deliverableId });
  });

  const show = new Command("show")
    .description("Show one task.")
    .argument("<campaignId>", "Campaign UUID")
    .argument("<deliverableId>", "Deliverable UUID")
    .argument("<taskId>", "Task UUID");
  addEnvironmentOption(show);
  addConfigOption(show);
  addVerbosityOptions(show);
  show.action(async (campaignId, deliverableId, taskId, options) => {
    await runTaskShow({ ...options, campaignId, deliverableId, taskId });
  });

  const create = new Command("create")
    .description("Create a task under a deliverable. Requires --apply.")
    .argument("<campaignId>", "Campaign UUID")
    .argument("<deliverableId>", "Deliverable UUID")
    .requiredOption("--name <name>", "Task name")
    .option("--due-date <iso>", "Due date (ISO-8601)")
    .option("--status <status>", "Initial status", "NOT_STARTED");
  addEnvironmentOption(create);
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
  addEnvironmentOption(update);
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

  task.addCommand(list);
  task.addCommand(show);
  task.addCommand(create);
  task.addCommand(update);
  return task;
};

export const createCampaignCommand = (): Command => {
  const command = new Command("campaign").description(
    "Sitecore Orchestrate campaigns — projects, deliverables, and tasks."
  );

  command.addCommand(createListCommand());
  command.addCommand(createShowCommand());
  command.addCommand(createCreateCommand());
  command.addCommand(createUsersCommand());
  command.addCommand(createDeliverableCommand());
  command.addCommand(createTaskCommand());
  command.addCommand(createCampaignSyncCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai ops campaign list -n agents\n" +
      "  $ scai ops campaign show <campaignId> -n agents\n" +
      "  $ scai ops campaign create --name 'Spring Launch' --apply -n agents\n" +
      "  $ scai ops campaign deliverable create <campaignId> --name 'Landing page' --apply\n" +
      "  $ scai ops campaign task create <campaignId> <deliverableId> --name 'Draft copy' --apply\n"
  );

  return command;
};
