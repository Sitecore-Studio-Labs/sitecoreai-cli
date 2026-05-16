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
      "Publish one or more items in a single job (Tier 1). Items can be addressed by GUID (--items) or by Sitecore content-tree path (--paths). At least one must be provided. Defaults to --what-if dry-run; pass --allow-write to actually publish. Production-tier envs additionally require --confirm-token from a prior dry-run."
    )
    .option(
      "--items <guid>",
      "Item ID (GUID) to publish. Repeatable, or pass a comma-separated list.",
      collectList,
      [] as string[]
    )
    .option(
      "--paths <path>",
      "Item path (e.g. /sitecore/content/Home). Repeatable, or pass a comma-separated list. Resolved to item IDs via Authoring GraphQL before submission.",
      collectList,
      [] as string[]
    )
    .option(
      "--site <name>",
      "Resolve the named site's content-tree root and add it to the publish target list. By default publishes ONLY the root item; combine with --include-subitems for the whole site."
    )
    .option("--item-type <type>", "ItemModel.type for the request body. Defaults to `item`.")
    .option(
      "-l, --languages <list>",
      "Literal language list (e.g. en-US,fr-CA). Mutually exclusive with --languages-from-site / --all-tenant-languages.",
      collectList,
      [] as string[]
    )
    .option(
      "--languages-from-site <name>",
      "Resolve the language list from the named site's configured languages (via Sites API). Logs the resolved set before submitting."
    )
    .option(
      "--all-tenant-languages",
      "Resolve the language list to every language registered in the tenant (via Sites API listLanguages)."
    )
    .option("--include-subitems", "Publish descendants of the items (xmc.items.publishChildren).")
    .option("--include-related", "Publish referenced items (xmc.items.publishRelatedItems).")
    .addOption(
      new Option(
        "--mode <mode>",
        "Publish mode. `Smart` skips items unchanged since the last publish; `Republish` forces re-emit of every item in the batch. Incremental is whole-environment only and lives on `publish all`."
      )
        .choices(["Smart", "Republish"])
        .default("Smart")
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
      "  1. Dry-run (default): scai content publish item --items <guid>[,<guid>...] -n <env>\n" +
      "     → prints the resolved scope and a scope token (5-min TTL)\n" +
      "  2. Real call: scai content publish item --items <guid>... -n <env> --allow-write\n" +
      "     → on non-prod envs, prompts [y/N]\n" +
      "     → on prod envs, ALSO requires --confirm-token <token>\n" +
      "\nExamples:\n" +
      "  $ scai content publish item --items abc123 -n sandbox\n" +
      "  $ scai content publish item --items abc123,def456,ghi789 -n sandbox\n" +
      "  $ scai content publish item --paths /sitecore/content/Home -n sandbox\n" +
      "  $ scai content publish item --paths /sitecore/content/Home,/sitecore/content/About -n sandbox\n" +
      "  $ scai content publish item --items abc123 --paths /sitecore/content/Home -n sandbox  # mix both\n" +
      "  $ scai content publish item --items abc123 --include-subitems -n sandbox              # + descendants\n" +
      "  $ scai content publish item --items abc1,def4 --mode Republish -n sandbox             # force re-emit\n" +
      "  $ scai content publish item --paths /sitecore/content/Home --languages-from-site marketing -n sandbox\n" +
      "  $ scai content publish item --items abc1 --all-tenant-languages -n sandbox            # every tenant lang\n" +
      "  $ scai content publish item --site marketing -n sandbox                                # site root only\n" +
      "  $ scai content publish item --site marketing --include-subitems -n sandbox             # whole site\n" +
      "  $ scai content publish item --site marketing --include-subitems --languages-from-site marketing -n sandbox\n"
  );

  command.action(async (options) => {
    await runPublishItem(options);
  });

  return command;
};
