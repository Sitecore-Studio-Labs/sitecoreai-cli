import { Command } from "commander";
import { runWebhookDelete } from "@/webhooks/tasks/delete";
import { addAllowWriteOption, addWhatIfOption } from "../shared";
import { addWebhookReadOptions } from "./shared";

export const createWebhookDeleteCommand = (): Command => {
  const command = new Command("delete")
    .description("Delete a webhook handler by item ID or path")
    .argument("<webhook>", "Item GUID or content-tree path of the handler")
    .action(async (webhook: string, options: Record<string, unknown>) => {
      await runWebhookDelete({ ...options, webhook } as never);
    });
  addWebhookReadOptions(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  return command;
};
