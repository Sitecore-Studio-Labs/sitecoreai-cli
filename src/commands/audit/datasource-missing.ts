import { Command } from "commander";
import { runAuditDatasourceMissing } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditDatasourceMissingCommand = (): Command => {
  const command = new Command("datasource-missing").description(
    "Find page items with rendering datasources that don't resolve"
  );

  const list = new Command("list").description(
    "List items whose __Renderings / __Final Renderings reference missing datasources"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.option("--batch-size <count>", "Aliased GraphQL batch size for field reads", (v) =>
    parseInt(v, 10)
  );
  list.option(
    "--report-query-datasources",
    "Also report Sitecore query: and local: datasources (which can't be resolved statically)"
  );
  list.action(async (options) => {
    await runAuditDatasourceMissing(options);
  });

  command.addCommand(list);
  return command;
};
