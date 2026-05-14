import { Command } from "commander";
import { createPublishLoginCommand } from "./login";
import { createPublishStatusCommand } from "./status";

export const createPublishCommand = (): Command => {
  const command = new Command("publish").description(
    "Publish content to Experience Edge. Verbs available: `login` (acquire publishing-scoped token) and `status`. `item`/`all`/`cancel` land in follow-up PRs with the full consent model. See docs/parity-with-devex.md."
  );

  command.addCommand(createPublishLoginCommand());
  command.addCommand(createPublishStatusCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai publish login -n sandbox                       # request xmcpub.* scopes (one-time setup)\n" +
      "  $ scai publish status                                 # list queued/running jobs\n" +
      "  $ scai publish status job_4F2B1                       # inspect a specific job\n" +
      "  $ scai publish status job_4F2B1 --json                # machine-readable\n"
  );

  return command;
};
