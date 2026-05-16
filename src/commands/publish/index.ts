import { Command } from "commander";
import { createPublishAllCommand } from "./all";
import { createPublishCancelCommand } from "./cancel";
import { createPublishHistoryCommand } from "./history";
import { createPublishItemCommand } from "./item";
import { createPublishStatusCommand } from "./status";
import { createPublishUnpublishCommand } from "./unpublish";

export const createPublishCommand = (): Command => {
  const command = new Command("publish").description(
    "Publish content to Experience Edge via the SAI Publishing API. Requires an environment-level automation client (Cloud Portal → Environments → [env] → Automation Clients)."
  );

  command.addCommand(createPublishItemCommand());
  command.addCommand(createPublishAllCommand());
  command.addCommand(createPublishStatusCommand());
  command.addCommand(createPublishCancelCommand());
  command.addCommand(createPublishUnpublishCommand());
  command.addCommand(createPublishHistoryCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai content publish item --item-id <guid> -n <env>                # dry-run, prints scope + token\n" +
      "  $ scai content publish item --item-id <guid> -n <env> --allow-write  # actually publish (non-prod)\n" +
      "  $ scai content publish status <jobId> -n <env>                       # inspect a publish job\n" +
      "\nSetup:\n" +
      "  1. Cloud Portal: Environments → [env] → Automation Clients → Create\n" +
      "  2. Set SITECOREAI_ENV_<NAME>_CLIENT_ID / _CLIENT_SECRET in your shell,\n" +
      "     or add clientId/clientSecret to the env profile in sitecoreai.cli.json\n" +
      "  3. scai mints the publishing token transparently with xmcpub.jobs.t:r/w scopes\n"
  );

  return command;
};
