import { Command } from "commander";
import { runAuditEmptyRoles } from "@/hygiene/tasks/audit/empty-roles";
import { addAuditBaseOptions } from "./shared";

export const createAuditEmptyRolesCommand = (): Command => {
  const command = new Command("empty-roles").description("Find roles with zero direct members");
  const list = new Command("list").description(
    "List roles whose members(first:1) returns an empty connection"
  );
  addAuditBaseOptions(list);
  list.option("--domain <name>", "Restrict to a specific domain (e.g. sitecore, extranet)");
  list.action(async (options) => {
    await runAuditEmptyRoles(options);
  });
  command.addCommand(list);
  return command;
};
