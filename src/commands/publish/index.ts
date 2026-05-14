import { Command } from "commander";
import { createPublishStatusCommand } from "./status";

export const createPublishCommand = (): Command => {
  const command = new Command("publish").description(
    "Publish content to Experience Edge via the SAI Publishing API. Requires an environment-level automation client (Cloud Portal → Environments → [env] → Automation Clients). Read-only `status` ships in PR 2a; `item`/`all`/`cancel` land in PR 2b with the full consent model. See docs/parity-with-devex.md."
  );

  command.addCommand(createPublishStatusCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai publish status <jobId>                         # inspect a publish job\n" +
      "  $ scai publish status <jobId> --json                  # machine-readable\n" +
      "\nSetup:\n" +
      "  1. In Cloud Portal: Environments → [env] → Automation Clients → Create\n" +
      "  2. Copy clientId/clientSecret into your env profile in sitecoreai.cli.json\n" +
      "     OR set SITECOREAI_ENV_<NAME>_CLIENT_ID / _CLIENT_SECRET in your shell\n" +
      "  3. scai mints the publishing token transparently with xmcpub.jobs.t:r/w scopes\n"
  );

  return command;
};
