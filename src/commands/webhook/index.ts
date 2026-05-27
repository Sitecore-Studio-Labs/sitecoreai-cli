import { Command } from "commander";
import { createWebhookCreateCommand } from "./create";
import { createWebhookDeleteCommand } from "./delete";
import { createWebhookEventsCommand } from "./events";
import { createWebhookGetCommand } from "./get";
import { createWebhookListCommand } from "./list";

export const createWebhookCommand = (): Command => {
  const command = new Command("webhook").description(
    "Manage Sitecore webhook handlers — item/publish event handlers and workflow submit/validation actions"
  );

  command.addCommand(createWebhookListCommand());
  command.addCommand(createWebhookGetCommand());
  command.addCommand(createWebhookEventsCommand());
  command.addCommand(createWebhookCreateCommand());
  command.addCommand(createWebhookDeleteCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai content workflow webhook list\n" +
      "  $ scai content workflow webhook list --event-type publish --enabled-only --json\n" +
      "  $ scai content workflow webhook events\n" +
      "  $ scai content workflow webhook events --category publish --json\n" +
      "  $ scai content workflow webhook get /sitecore/system/Webhooks/CI-Notify\n" +
      "  $ scai content workflow webhook create --name CI-Notify --url https://ci.example.com/hook \\\n" +
      "        --event item --events item:saved,item:deleted\n" +
      "  $ scai content workflow webhook create --name PublishHook --url https://ci.example.com/publish \\\n" +
      "        --event publish --events publish:end\n" +
      "  $ scai content workflow webhook create --name NotifyReviewer --url https://ci.example.com/wf \\\n" +
      "        --event workflow --on-state '/sitecore/system/Workflows/Editorial/In Review' \\\n" +
      "        --action submit --what-if\n" +
      "  $ scai content workflow webhook delete /sitecore/system/Webhooks/CI-Notify\n"
  );

  return command;
};
