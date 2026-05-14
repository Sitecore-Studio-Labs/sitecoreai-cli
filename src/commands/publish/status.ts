import { Command } from "commander";
import { runPublishStatus } from "@/publishing/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createPublishStatusCommand = (): Command => {
  const command = new Command("status")
    .description(
      "Show the state of a publish job by id. The Authoring GraphQL surface does not expose a list-jobs endpoint; capture the id from the publish call that started the job, or read it from `~/.sitecoreai/audit.log` once that subsystem ships (PR 2b)."
    )
    .argument(
      "<jobId>",
      "Publish job id returned by `scai publish item` / `scai publish all` (or recorded in the audit log)."
    );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (jobId: string | undefined, options) => {
    await runPublishStatus({ ...options, jobId });
  });

  return command;
};
