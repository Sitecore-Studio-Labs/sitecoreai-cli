import { Command } from "commander";
import { runWebhookList } from "@/webhooks/tasks";
import { addWebhookReadOptions } from "./shared";

export const createWebhookListCommand = (): Command => {
  const command = new Command("list")
    .description("List webhook handler items under the webhook tree")
    .option(
      "--root <path>",
      "Override the content-tree root (default: /sitecore/system/Webhooks; for workflow webhooks pass a workflow state path)"
    )
    .option(
      "--event-type <category>",
      "Filter by category: item | publish | workflow",
      (value) => {
        if (!["item", "publish", "workflow"].includes(value)) {
          throw new Error(`Invalid --event-type '${value}'. Use item | publish | workflow.`);
        }
        return value;
      }
    )
    .option("--enabled-only", "Return only enabled handlers")
    .action(async (options: Record<string, unknown>) => {
      await runWebhookList(options as never);
    });
  addWebhookReadOptions(command);
  return command;
};
