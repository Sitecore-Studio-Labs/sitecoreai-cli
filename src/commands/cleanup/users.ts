import { Command } from "commander";
import { runCleanupUsers } from "@/hygiene/tasks/cleanup/users";
import { withApplyGate } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupUsersCommand = (): Command => {
  const command = new Command("users").description(
    "Delete stale users (the cleanup counterpart to `audit stale-users`)"
  );

  const purgeStale = new Command("purge-stale").description(
    "Delete users inactive for more than --not-active-days (default 365)"
  );
  addCleanupBaseOptions(purgeStale);
  purgeStale.option(
    "--not-active-days <count>",
    "Inactivity threshold in days (default 365)",
    (v) => parseInt(v, 10)
  );
  purgeStale.option("--max-deletions <count>", "Cap on total deletions per run (default 25)", (v) =>
    parseInt(v, 10)
  );
  purgeStale.option("--include-admins", "Include administrators (strongly discouraged)");
  purgeStale.option(
    "--include-service-accounts",
    "Include likely service accounts (their lastLoginDate doesn't reflect OAuth access)"
  );
  purgeStale.option(
    "--use-activity-date",
    "Use UserProfile.lastActivityDate instead of lastLoginDate"
  );
  purgeStale.addHelpText(
    "after",
    "\nDefault threshold is 365 days (vs 180 for the audit) — deleting users is\n" +
      "more destructive than flagging them, so the bar is higher.\n"
  );
  purgeStale.action(withApplyGate(runCleanupUsers));
  command.addCommand(purgeStale);
  return command;
};
