import { Command, Option } from "commander";
import { runBriefTodosList } from "@/brief/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

/**
 * `scai ops brief todos [briefId]` — list the to-dos on a brief.
 *
 * "Todo" is the label the Sitecore Content Operations UI uses. The Brief
 * API wire resource is `tasks` (see `src/brief/api/tasks.ts`); only the
 * scai-facing surface uses "todo".
 */
export const createBriefTodosCommand = (): Command => {
  const command = new Command("todos")
    .description("List to-dos across briefs, or filter to one brief with [briefId].")
    .argument("[briefId]", "Brief UUID to filter to-dos to. Omit for tenant-wide listing.");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--assignees", "Expand assignee metadata"));
  command.addOption(new Option("--limit <n>", "Page size").argParser((v) => Number(v)));

  command.action(async (briefId: string | undefined, options) => {
    await runBriefTodosList({ ...options, briefId });
  });

  return command;
};
