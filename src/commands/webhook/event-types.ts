import { Command } from "commander";
import { runWebhookEventTypes } from "@/webhooks/tasks";
import { addWebhookReadOptions } from "./shared";

export const createWebhookEventTypesCommand = (): Command => {
  const command = new Command("event-types")
    .description(
      "List the event-type catalog the tenant accepts (the strings you pass to `--events` on `webhook create`)"
    )
    .option("--category <name>", "Limit to a single branch: item | publish", (value) => {
      if (!["item", "publish"].includes(value)) {
        throw new Error(`Invalid --category '${value}'. Use item | publish.`);
      }
      return value;
    })
    .action(async (options: Record<string, unknown>) => {
      await runWebhookEventTypes(options as never);
    });
  addWebhookReadOptions(command);
  return command;
};
