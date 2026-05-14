import { Command } from "commander";
import { runAuditRoleBloat } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditRoleBloatCommand = (): Command => {
  const command = new Command("role-bloat").description(
    "Find users with more than N role memberships (default 10)"
  );
  const list = new Command("list").description(
    "List users whose direct role count exceeds --threshold"
  );
  addAuditBaseOptions(list);
  list.option("--threshold <count>", "Role-count threshold (default 10)", (v) => parseInt(v, 10));
  list.option("--include-admins", "Include administrators (off by default)");
  list.action(async (options) => {
    await runAuditRoleBloat(options);
  });
  command.addCommand(list);
  return command;
};
