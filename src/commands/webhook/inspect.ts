import { Command } from "commander";
import { runWebhookInspect } from "@/webhooks/tasks";
import { addWebhookReadOptions } from "./shared";

export const createWebhookInspectCommand = (): Command => {
  const command = new Command("inspect")
    .description("Show a webhook handler's URL, events, authorization, and other fields")
    .argument("<webhook>", "Item GUID or content-tree path of the handler")
    .action(async (webhook: string, options: Record<string, unknown>) => {
      await runWebhookInspect({ ...options, webhook } as never);
    });
  addWebhookReadOptions(command);
  return command;
};
