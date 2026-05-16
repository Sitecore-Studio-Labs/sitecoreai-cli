import { Command, Option } from "commander";
import { runExplainOrphanSite } from "@/hygiene/tasks/explain/orphan-site";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

/**
 * `scai hygiene explain orphan-site <site>` — read-only verb that
 * composes `audit site-residue` and `audit references` into one
 * answer: "here is every orphan tree left behind for this site, and
 * which of them is still referenced by live content."
 *
 * Pair with `cleanup site-residue purge`: this tells you which orphans
 * are safe to purge now and which need their referrers resolved first.
 */
export const createExplainOrphanSiteCommand = (): Command => {
  const command = new Command("orphan-site")
    .description(
      "Show the orphan trees left behind for <site>, flagging any still referenced by live content"
    )
    .argument("<site>", "Site (or tenant) folder name to inspect");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command
    .addOption(new Option("--index <name>", "Override the search index name"))
    .addOption(
      new Option("--limit <count>", "Cap on inbound refs counted per orphan tree").argParser((v) =>
        parseInt(v, 10)
      )
    );
  command.addHelpText(
    "after",
    "\nAfter a Sites-API site delete, folders survive under\n" +
      "/sitecore/templates/Project, /layout, and the media library. This\n" +
      "verb finds them and checks each for inbound references — so you\n" +
      "know which are safe to `cleanup site-residue purge` and which need\n" +
      "their referrers resolved first.\n"
  );
  command.action(async (site: string, options) => {
    await runExplainOrphanSite({ ...options, site });
  });
  return command;
};
