import { Command, Option } from "commander";
import { runPublishUnpublish } from "@/publishing/tasks/unpublish";
import {
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
  collectList,
} from "../shared";

export const createPublishUnpublishCommand = (): Command => {
  const command = new Command("unpublish")
    .description(
      "Unpublish one or more items. Writes a publish-state field via the Authoring API (or calls deleteItem for --strategy delete), then submits a publish job so Edge picks up the removal. Defaults to the reversible `never-publish` strategy; pass --strategy expire-now to set `__Valid to: now`, or --strategy delete for permanent removal (typed-item-path confirmation required)."
    )
    .option(
      "--items <guid>",
      "Item ID (GUID) to unpublish. Repeatable, or pass a comma-separated list.",
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
      "-l, --languages <list>",
      "Comma-separated languages (e.g. en-US,fr-CA). When unset, scai uses --site to look up the site's configured languages via the Sites API; otherwise falls back to 'en' for field writes.",
      collectList,
      [] as string[]
    )
    .option(
      "--site <name>",
      "Site name. When set and --languages is empty, scai auto-fills languages from the named site (Sites API)."
    )
    .option("--include-subitems", "Publish descendants in the follow-up publish job.")
    .option("--include-related", "Publish referenced items in the follow-up publish job.")
    .addOption(
      new Option(
        "--strategy <mode>",
        "Unpublish mechanism. `never-publish` (default, reversible) sets `__Never publish: true`. `expire-now` (reversible) sets `__Valid to: <now>`. `delete` (NOT reversible) calls deleteItem and requires typed-item-path confirmation per item."
      )
        .choices(["never-publish", "expire-now", "delete"])
        .default("never-publish")
    )
    .option(
      "--confirm-token <token>",
      "Scope token obtained from a previous dry-run. Required on production-tier envs."
    )
    .option(
      "--confirm-item-path <path>",
      "For --strategy delete with --yes: the exact resolved item path the operator is authorizing to delete. Must match scai's path resolution for each item. Without this (and --yes), scai prompts interactively per item."
    )
    .option(
      "--yes",
      "Skip the [y/N] prompt on non-production envs. Has no effect on production-tier — those always require --confirm-token. For --strategy delete: also requires --confirm-item-path."
    )
    .addOption(
      new Option("--name <name>", "Override the API job name for the follow-up publish job.")
    )
    .addOption(new Option("--source <source>", "Override the API source field. Default `scai`."));

  addEnvironmentOption(command);
  addConfigOption(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nFlow:\n" +
      "  1. Dry-run (default): scai publish unpublish --items <guid> -n <env>\n" +
      "     → prints the resolved scope and a scope token (5-min TTL)\n" +
      "  2. Real call: scai publish unpublish --items <guid> -n <env> --allow-write\n" +
      "     → writes `__Never publish: true` (or `__Valid to: <now>` for --strategy expire-now)\n" +
      "     → then submits a Publishing API job so Edge picks up the removal\n" +
      "  Reverse:\n" +
      "     scai content version set-never-publish --item-id <guid> --value false -n <env> --allow-write\n" +
      "     scai publish item --items <guid> -n <env> --allow-write\n" +
      "\nExamples:\n" +
      "  $ scai publish unpublish --items abc123 -n sandbox\n" +
      "  $ scai publish unpublish --paths /sitecore/content/Home -n sandbox\n" +
      "  $ scai publish unpublish --items abc123 --strategy expire-now -n sandbox\n"
  );

  command.action(async (options) => {
    await runPublishUnpublish(options);
  });

  return command;
};
