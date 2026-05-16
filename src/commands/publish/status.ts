import { Command, Option } from "commander";
import { runPublishStatus } from "@/publishing/tasks/status";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

const parseIntOpt = (value: string): number => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected positive integer, got '${value}'.`);
  }
  return n;
};

export const createPublishStatusCommand = (): Command => {
  const command = new Command("status")
    .description(
      "Show the state of a publish job, or list queued/running jobs when no jobId is given. Pass --watch to poll until the job reaches a terminal state (completed/failed/cancelled)."
    )
    .argument(
      "[jobId]",
      "Publish job id (e.g. job_4F2B1). When omitted, lists jobs currently queued or running."
    )
    .option("--watch", "Poll until the job reaches a terminal state. Requires a jobId.")
    .addOption(
      new Option(
        "--poll-interval-s <seconds>",
        "Polling interval in seconds (default 5, clamped to [2, 60])."
      ).argParser(parseIntOpt)
    )
    .addOption(
      new Option(
        "--timeout-s <seconds>",
        "Hard timeout for --watch in seconds (default 1800). Throws NETWORK error if the job hasn't reached a terminal state by then."
      ).argParser(parseIntOpt)
    );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai content publish status -n sandbox                          # list queued/running\n" +
      "  $ scai content publish status job_abc123 -n sandbox               # one-shot status\n" +
      "  $ scai content publish status job_abc123 -n sandbox --watch       # follow until terminal\n" +
      "  $ scai content publish status job_abc123 -n sandbox --watch --json  # CI-friendly stream\n"
  );

  command.action(async (jobId: string | undefined, options) => {
    await runPublishStatus({ ...options, jobId });
  });

  return command;
};
