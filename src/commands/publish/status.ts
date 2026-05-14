import { Command } from "commander";
import { runPublishStatus } from "@/publishing/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createPublishStatusCommand = (): Command => {
  const command = new Command("status")
    .description(
      "Show the state of a publish job, or list queued/running jobs when no jobId is given."
    )
    .argument(
      "[jobId]",
      "Publish job id (e.g. job_4F2B1). When omitted, lists jobs currently queued or running."
    );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (jobId: string | undefined, options) => {
    await runPublishStatus({ ...options, jobId });
  });

  return command;
};
