import { Command, Option } from "commander";
import { runExplainWhyBlocked } from "@/hygiene/tasks/explain/why-blocked";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

/**
 * `scai hygiene explain why-blocked <itemId>` — read-only verb that combines
 * `audit references` and `audit template-dependencies` into one
 * report: "here is every inbound reference that would block (or
 * potentially block) a delete of this item, grouped by reference kind."
 *
 * Lives in its own command group (`explain/`) rather than under
 * `audit/` because the verb composes two audits — placing it under
 * either would imply a hierarchy that doesn't match how operators
 * reach for it.
 */
export const createExplainWhyBlockedCommand = (): Command => {
  const command = new Command("why-blocked")
    .description(
      "Show every inbound reference that would block a delete of <itemId>, grouped by reference kind"
    )
    .argument("<itemId>", "Item ID (any GUID form) to inspect");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command
    .addOption(
      new Option(
        "--root <path>",
        "Content root for the field-value scan (default: /sitecore/content)"
      )
    )
    .addOption(new Option("--index <name>", "Override the search index name"))
    .addOption(
      new Option("--limit <count>", "Cap on results per scan kind (default: 5000)").argParser((v) =>
        parseInt(v, 10)
      )
    )
    .addOption(
      new Option(
        "--skip-content-scan",
        "Skip the field-value content scan. Use when only structural template refs matter (faster)."
      )
    )
    .addOption(
      new Option(
        "--skip-template-deps",
        "Skip the search-index template-dependency check. Use for leaf content items that aren't referenced as templates."
      )
    )
    .addOption(
      new Option(
        "--cache",
        "Reuse the on-disk field cache for the content scan (faster when running back-to-back checks against the same --root)."
      )
    );
  command.addHelpText(
    "after",
    "\nThe Authoring API rejects deletes with terse messages like\n" +
      '"Template is used by at least one item." This verb tells you which\n' +
      "items, and by what reference kind. Use before a cleanup or delete\n" +
      "fails so you can resolve blockers up front instead of decoding the\n" +
      "API error after the fact.\n"
  );
  command.action(async (itemId: string, options) => {
    await runExplainWhyBlocked({ ...options, itemId });
  });
  return command;
};
