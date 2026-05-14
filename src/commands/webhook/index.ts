import { Command } from "commander";
import { createWebhookCreateCommand } from "./create";
import { createWebhookDeleteCommand } from "./delete";
import { createWebhookEventTypesCommand } from "./event-types";
import { createWebhookInspectCommand } from "./inspect";
import { createWebhookListCommand } from "./list";

export const createWebhookCommand = (): Command => {
  const command = new Command("webhook").description(
    "Manage Sitecore webhook handlers — item/publish event handlers and workflow submit/validation actions"
  );

  command.addCommand(createWebhookListCommand());
  command.addCommand(createWebhookInspectCommand());
  command.addCommand(createWebhookEventTypesCommand());
  command.addCommand(createWebhookCreateCommand());
  command.addCommand(createWebhookDeleteCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai webhook list\n" +
      "  $ scai webhook list --event-type publish --enabled-only --json\n" +
      "  $ scai webhook event-types\n" +
      "  $ scai webhook event-types --category publish --json\n" +
      "  $ scai webhook inspect /sitecore/system/Webhooks/CI-Notify\n" +
      "  $ scai webhook create --name CI-Notify --url https://ci.example.com/hook \\\n" +
      "        --event item --events item:saved,item:deleted\n" +
      "  $ scai webhook create --name PublishHook --url https://ci.example.com/publish \\\n" +
      "        --event publish --events publish:end\n" +
      "  $ scai webhook create --name NotifyReviewer --url https://ci.example.com/wf \\\n" +
      "        --event workflow --on-state '/sitecore/system/Workflows/Editorial/In Review' \\\n" +
      "        --action submit --what-if\n" +
      "  $ scai webhook delete /sitecore/system/Webhooks/CI-Notify\n"
  );

  return command;
};
