import { Command } from "commander";
import { runWebhookGet } from "@/webhooks/tasks/get";
import { addWebhookReadOptions } from "./shared";

export const createWebhookGetCommand = (): Command => {
  const command = new Command("get")
    .description("Get a webhook handler's URL, events, authorization, and other fields")
    .argument("<webhook>", "Item GUID or content-tree path of the handler")
    .action(async (webhook: string, options: Record<string, unknown>) => {
      await runWebhookGet({ ...options, webhook } as never);
    });
  addWebhookReadOptions(command);
  return command;
};
