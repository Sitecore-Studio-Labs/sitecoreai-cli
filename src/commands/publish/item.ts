import { Command, Option } from "commander";
import { runPublishItem } from "@/publishing/tasks/item";
import {
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
  collectList,
} from "../shared";

export const createPublishItemCommand = (): Command => {
  const command = new Command("item")
    .description(
      "Publish one or more items in a single job (Tier 1). Defaults to --what-if dry-run; pass --allow-write to actually publish. Production-tier envs additionally require --confirm-token from a prior dry-run."
    )
    .requiredOption(
      "--items <guid>",
      "Item ID (GUID) to publish. Repeatable, or pass a comma-separated list. All items are bundled into a single publishing job.",
      collectList,
      [] as string[]
    )
    .option("--item-type <type>", "ItemModel.type for the request body. Defaults to `item`.")
    .option(
      "-l, --languages <list>",
      "Comma-separated languages (e.g. en-US,fr-CA). Defaults to env-configured publish languages.",
      collectList,
      [] as string[]
    )
    .option("--include-subitems", "Publish descendants of the items (xmc.items.publishChildren).")
    .option("--include-related", "Publish referenced items (xmc.items.publishRelatedItems).")
    .addOption(
      new Option(
        "--mode <mode>",
        "Publish mode. `Smart` skips items unchanged since the last publish; `Republish` forces re-emit of every item in the batch. Incremental is whole-site only and lives on `publish all`."
      )
        .choices(["Smart", "Republish"])
        .default("Smart")
    )
    .option(
      "--republish",
      "Alias for `--mode Republish` (matches the dotnet `sitecore publish item --republish` flag). When both are set, `--mode` wins."
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
      "  1. Dry-run (default): scai publish item --items <guid>[,<guid>...] -n <env>\n" +
      "     → prints the resolved scope and a scope token (5-min TTL)\n" +
      "  2. Real call: scai publish item --items <guid>... -n <env> --allow-write\n" +
      "     → on non-prod envs, prompts [y/N]\n" +
      "     → on prod envs, ALSO requires --confirm-token <token>\n" +
      "\nExamples:\n" +
      "  $ scai publish item --items abc123 -n sandbox\n" +
      "  $ scai publish item --items abc123,def456,ghi789 -n sandbox\n" +
      "  $ scai publish item --items abc123 --items def456 -n sandbox      # repeated flag\n" +
      "  $ scai publish item --items abc123 --include-subitems -n sandbox  # + descendants\n" +
      "  $ scai publish item --items abc1,def4 --mode Republish -n sandbox # force re-emit\n"
  );

  command.action(async (options) => {
    await runPublishItem(options);
  });

  return command;
};
