import { Command } from "commander";
import { runPublishCancel } from "@/publishing/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createPublishCancelCommand = (): Command => {
  const command = new Command("cancel")
    .description(
      "Cancel a queued or running publish job. The API only honours cancellation for Queued / Running jobs; Completed / Failed / already-Cancelled jobs cannot be cancelled."
    )
    .argument("<jobId>", "Publish job id returned by `scai publish item` / `scai publish all`.");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (jobId: string, options) => {
    await runPublishCancel({ ...options, jobId });
  });

  return command;
};
