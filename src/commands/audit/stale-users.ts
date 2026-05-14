import { Command } from "commander";
import { runAuditStaleUsers } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditStaleUsersCommand = (): Command => {
  const command = new Command("stale-users").description(
    "Find users inactive for N days (default 180)"
  );
  const list = new Command("list").description(
    "List users whose UserProfile.lastActivity is older than --not-active-days or null"
  );
  addAuditBaseOptions(list);
  list.option("--not-active-days <count>", "Inactivity threshold in days (default 180)", (v) =>
    parseInt(v, 10)
  );
  list.option("--include-admins", "Include administrators (off by default)");
  list.option(
    "--include-service-accounts",
    "Include likely service accounts (off by default; lastLoginDate doesn't reflect OAuth client-credential access)"
  );
  list.option(
    "--use-activity-date",
    "Use UserProfile.lastActivityDate instead of lastLoginDate (broader signal)"
  );
  list.action(async (options) => {
    await runAuditStaleUsers(options);
  });
  command.addCommand(list);
  return command;
};
