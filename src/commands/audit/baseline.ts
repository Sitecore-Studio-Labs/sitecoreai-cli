import { Command } from "commander";
import {
  runBaselineCreate,
  runBaselineRemove,
  runBaselineReset,
  runBaselineShow,
} from "@/hygiene/tasks/audit-baseline";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions, collectList } from "../shared";

export const createAuditBaselineCommand = (): Command => {
  const command = new Command("baseline").description(
    "Manage the per-env audit baseline (ignore-list of accepted findings)"
  );

  const show = new Command("show").description("Print the current baseline contents");
  addEnvironmentOption(show);
  addConfigOption(show);
  addVerbosityOptions(show);
  show.action(async (options) => {
    await runBaselineShow(options);
  });
  command.addCommand(show);

  const create = new Command("create").description(
    "Run audits and add every current finding to the baseline (accept-all snapshot)"
  );
  addEnvironmentOption(create);
  addConfigOption(create);
  addVerbosityOptions(create);
  create.option(
    "--audits <names>",
    "Comma-separated audit names to snapshot. Default: all audits",
    collectList,
    []
  );
  create.option("--reset", "Reset the baseline for the chosen audits before adding new entries");
  create.option("--root <path>", "Default content root (default: /sitecore/content)");
  create.option("--limit <count>", "Cap on items per audit", (v) => parseInt(v, 10));
  create.option("--include-system", "Include /sitecore/system items");
  create.action(async (options) => {
    await runBaselineCreate(options);
  });
  command.addCommand(create);

  const remove = new Command("remove").description("Remove a single entry from the baseline");
  addEnvironmentOption(remove);
  addConfigOption(remove);
  addVerbosityOptions(remove);
  remove.requiredOption("--audit <name>", "Audit name (e.g. broken-links)");
  remove.requiredOption("--fingerprint <hex>", "Fingerprint shown by `audit baseline show`");
  remove.action(async (options) => {
    await runBaselineRemove(options);
  });
  command.addCommand(remove);

  const reset = new Command("reset").description(
    "Wipe the baseline for one audit (or all audits if --audit is omitted)"
  );
  addEnvironmentOption(reset);
  addConfigOption(reset);
  addVerbosityOptions(reset);
  reset.option("--audit <name>", "Audit name to reset (default: all)");
  reset.action(async (options) => {
    await runBaselineReset(options);
  });
  command.addCommand(reset);

  command.addHelpText(
    "after",
    "\nThe baseline lives at `.scai/audit-baseline-<envName>.json` (per-env).\n" +
      "Pass --baseline to any audit command to filter out findings that match.\n" +
      "\nWorkflow:\n" +
      "  1. scai audit all                    # see all findings\n" +
      "  2. scai audit baseline create        # accept everything as the new baseline\n" +
      "  3. scai audit all --baseline         # in CI: only flag NEW findings\n"
  );

  return command;
};
