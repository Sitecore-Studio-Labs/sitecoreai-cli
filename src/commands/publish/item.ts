import { Command, Option } from "commander";
import { runPublishItem } from "@/publishing/tasks/item";
import {
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";

export const createPublishItemCommand = (): Command => {
  const command = new Command("item")
    .description(
      "Publish a single item (Tier 1). Defaults to --what-if dry-run; pass --allow-write to actually publish. Production-tier envs additionally require --confirm-token from a prior dry-run."
    )
    .requiredOption(
      "--item-id <guid>",
      "Item ID (GUID) to publish. Path-based publishing isn't supported yet."
    )
    .option("--item-type <type>", "ItemModel.type for the request body. Defaults to `item`.")
    .option(
      "-l, --languages <list>",
      "Comma-separated languages (e.g. en-US,fr-CA). Defaults to env-configured publish languages.",
      (value: string) =>
        value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      [] as string[]
    )
    .option("--include-subitems", "Publish descendants of the item (xmc.items.publishChildren).")
    .option("--include-related", "Publish referenced items (xmc.items.publishRelatedItems).")
    .option(
      "--republish",
      "Use Republish mode instead of Smart (forces re-emit of unchanged items)."
    )
    .option(
      "--confirm-token <token>",
      "Scope token obtained from a previous dry-run. Required on production-tier envs."
    )
    .option(
      "--yes",
      "Skip the [y/N] prompt on non-production envs. Has no effect on production-tier — those always require --confirm-token."
    )
    .addOption(new Option("--name <name>", "Override the API job name (the publishing UI label)."))
    .addOption(new Option("--source <source>", "Override the API source field. Default `scai`."));

  addEnvironmentOption(command);
  addConfigOption(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nFlow:\n" +
      "  1. Dry-run (default): scai publish item --item-id <guid> -n <env>\n" +
      "     → prints the resolved scope and a scope token (5-min TTL)\n" +
      "  2. Real call: scai publish item --item-id <guid> -n <env> --allow-write\n" +
      "     → on non-prod envs, prompts [y/N]\n" +
      "     → on prod envs, ALSO requires --confirm-token <token>\n"
  );

  command.action(async (options) => {
    await runPublishItem(options);
  });

  return command;
};
