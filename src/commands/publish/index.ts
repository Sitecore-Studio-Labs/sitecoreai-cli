import { Command } from "commander";
import { createPublishStatusCommand } from "./status";

export const createPublishCommand = (): Command => {
  const command = new Command("publish").description(
    "Publish content to Experience Edge via the Authoring GraphQL `publish` surface. Read-only `status` ships in PR 2a; `item` / `all` land in PR 2b with the full consent model. See docs/parity-with-devex.md."
  );

  command.addCommand(createPublishStatusCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai publish status <jobId>                         # inspect a publish job\n" +
      "  $ scai publish status <jobId> --json                  # machine-readable\n"
  );

  return command;
};
