import { Command, Option } from "commander";
import { runBriefTasksList } from "@/brief/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createBriefTasksCommand = (): Command => {
  const command = new Command("tasks")
    .description("List tasks across briefs, or filter to one brief with [briefId].")
    .argument("[briefId]", "Brief UUID to filter tasks to. Omit for tenant-wide listing.");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--assignees", "Expand assignee metadata"));
  command.addOption(new Option("--limit <n>", "Page size").argParser((v) => Number(v)));

  command.action(async (briefId: string | undefined, options) => {
    await runBriefTasksList({ ...options, briefId });
  });

  return command;
};
