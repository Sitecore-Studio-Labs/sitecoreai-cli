import { Command } from "commander";
import { runWebhookEvents } from "@/webhooks/tasks/events";
import { addWebhookReadOptions } from "./shared";

export const createWebhookEventsCommand = (): Command => {
  const command = new Command("events")
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
      await runWebhookEvents(options as never);
    });
  addWebhookReadOptions(command);
  return command;
};
