import { Command } from "commander";
import { runWebhookCreate } from "@/webhooks/tasks";
import { addAllowWriteOption, addWhatIfOption, collectList } from "../shared";
import { addWebhookReadOptions } from "./shared";

const parseEventCategory = (value: string): string => {
  if (!["item", "publish", "workflow"].includes(value)) {
    throw new Error(`Invalid --event '${value}'. Use item | publish | workflow.`);
  }
  return value;
};

const parseActionKind = (value: string): string => {
  if (!["submit", "validation"].includes(value)) {
    throw new Error(`Invalid --action '${value}'. Use submit | validation.`);
  }
  return value;
};

const parseSerializationType = (value: string): string => {
  if (!["JSON", "XML"].includes(value)) {
    throw new Error(`Invalid --serialization-type '${value}'. Use JSON | XML.`);
  }
  return value;
};

export const createWebhookCreateCommand = (): Command => {
  const command = new Command("create")
    .description(
      "Create a webhook handler — pick an event category and supply the URL + event names (or workflow state for workflow webhooks)"
    )
    .requiredOption("--name <name>", "Sitecore item name for the new handler")
    .requiredOption("--url <url>", "Webhook target URL")
    .requiredOption(
      "--event <category>",
      "Event category: item | publish | workflow",
      parseEventCategory
    )
    .option(
      "--events <names>",
      "Event-type names for item/publish flavors (comma-separated or repeated). Examples: item:saved, item:deleted, publish:end",
      collectList,
      []
    )
    .option(
      "--on-state <path>",
      "Workflow state or command path (workflow flavor only). The action item is created at <on-state>/Actions/<name>."
    )
    .option(
      "--action <kind>",
      "Workflow action kind: submit (default, runs after transition) | validation (synchronous gate)",
      parseActionKind
    )
    .option("--description <text>", "Optional description recorded on the handler")
    .option(
      "--authorization <path>",
      "Absolute path to an Authorization item under /sitecore/system/Settings/Webhooks/Authorizations"
    )
    .option(
      "--serialization-type <type>",
      "Payload serialization: JSON (default) | XML",
      parseSerializationType
    )
    .option(
      "--parent-path <path>",
      "Override parent path for item/publish handlers (default: /sitecore/system/Webhooks)"
    )
    .option("--disabled", "Create the handler disabled (default: enabled)")
    .action(async (options: Record<string, unknown>) => {
      const enabled = options.disabled === true ? false : undefined;
      await runWebhookCreate({
        ...options,
        ...(enabled !== undefined && { enabled }),
      } as never);
    });
  addWebhookReadOptions(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  return command;
};
