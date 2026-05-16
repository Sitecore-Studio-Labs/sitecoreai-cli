import { Command } from "commander";
import { runPublishCancel } from "@/publishing/tasks/cancel";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createPublishCancelCommand = (): Command => {
  const command = new Command("cancel")
    .description(
      "Cancel a queued or running publish job. Pass <jobId> for one, or --all-queued to sweep every queued/running job in the env (gated behind a typed env-name confirmation). The API only honours cancellation for Queued / Running jobs; Completed / Failed / already-Cancelled jobs cannot be cancelled."
    )
    .argument(
      "[jobId]",
      "Publish job id returned by `scai content publish item` / `scai content publish all`. Omit when using --all-queued."
    )
    .option(
      "--all-queued",
      "Cancel every queued and running publish job in the env. Requires a typed env-name confirmation (or --yes in CI)."
    )
    .option("--yes", "Skip the typed env-name prompt when using --all-queued (CI use).");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai content publish cancel job_abc123 -n sandbox\n" +
      "  $ scai content publish cancel --all-queued -n sandbox\n" +
      "  $ scai content publish cancel --all-queued -n sandbox --yes  # CI / scripted use\n"
  );

  command.action(async (jobId: string | undefined, options) => {
    await runPublishCancel({ ...options, jobId });
  });

  return command;
};
