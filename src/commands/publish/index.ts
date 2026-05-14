import { Command } from "commander";
import { createPublishStatusCommand } from "./status";

export const createPublishCommand = (): Command => {
  const command = new Command("publish").description(
    "Publish content to Experience Edge. Read-only verbs ship in PR 1 (status); item/all/cancel land in follow-up PRs with the full consent model. See docs/parity-with-devex.md."
  );

  command.addCommand(createPublishStatusCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai publish status                                 # list queued/running jobs\n" +
      "  $ scai publish status job_4F2B1                       # inspect a specific job\n" +
      "  $ scai publish status job_4F2B1 --json                # machine-readable\n"
  );

  return command;
};
