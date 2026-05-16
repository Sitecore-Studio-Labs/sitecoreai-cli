import { Command } from "commander";
import { runAuditOrphans } from "@/hygiene/tasks/audit/orphans";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createAuditOrphansCommand = (): Command => {
  const command = new Command("orphans").description(
    "Find items in the Sitecore archive (recycle bin) — the XM Cloud analogue of orphan items"
  );

  const list = new Command("list").description("List archived (orphan) items");
  addEnvironmentOption(list);
  addConfigOption(list);
  addVerbosityOptions(list);
  list.option("--archive-name <name>", "Limit to a specific archive (default: all archives)");
  list.option("--page-size <count>", "Page size for the archive listing", (v) => parseInt(v, 10));
  list.option("--limit <count>", "Maximum number of archived items to return", (v) =>
    parseInt(v, 10)
  );
  list.action(async (options) => {
    await runAuditOrphans(options);
  });

  command.addCommand(list);
  return command;
};
