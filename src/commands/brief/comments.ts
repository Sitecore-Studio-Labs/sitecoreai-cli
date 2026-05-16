import { Command, Option } from "commander";
import { runBriefCommentsList } from "@/brief/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createBriefCommentsCommand = (): Command => {
  const command = new Command("comments")
    .description("List comments across briefs, or filter to one brief with [briefId].")
    .argument("[briefId]", "Brief UUID to filter comments to. Omit for tenant-wide listing.");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--limit <n>", "Page size").argParser((v) => Number(v)));

  command.action(async (briefId: string | undefined, options) => {
    await runBriefCommentsList({ ...options, briefId });
  });

  return command;
};
