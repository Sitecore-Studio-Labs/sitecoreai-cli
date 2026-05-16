import { Command } from "commander";
import { runAuditPageDesignOrphans } from "@/hygiene/tasks/audit/page-design-orphans";
import { addAuditBaseOptions } from "./shared";

export const createAuditPageDesignOrphansCommand = (): Command => {
  const command = new Command("page-design-orphans").description(
    "Find pages referencing missing page designs (XM Cloud SXA)"
  );

  const list = new Command("list").description(
    "List pages whose __Final Page Design / __Page Design field points to a missing item"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.action(async (options) => {
    await runAuditPageDesignOrphans(options);
  });

  command.addCommand(list);
  return command;
};
