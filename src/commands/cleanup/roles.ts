import { Command } from "commander";
import { runCleanupRoles } from "@/hygiene/tasks";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupRolesCommand = (): Command => {
  const command = new Command("roles").description(
    "Delete empty roles (the cleanup counterpart to `audit empty-roles`)"
  );

  const purgeEmpty = new Command("purge-empty").description(
    "Delete every role flagged by `audit empty-roles list`"
  );
  addCleanupBaseOptions(purgeEmpty);
  purgeEmpty.option("--domain <name>", "Restrict to a specific domain");
  purgeEmpty.option("--max-deletions <count>", "Cap on total deletions per run (default 50)", (v) =>
    parseInt(v, 10)
  );
  purgeEmpty.addHelpText(
    "after",
    "\nReview `audit empty-roles list` output BEFORE running this — some empty roles\n" +
      "are platform-internal and removing them breaks Sitecore's role model.\n"
  );
  purgeEmpty.action(async (options) => {
    await runCleanupRoles(options);
  });
  command.addCommand(purgeEmpty);
  return command;
};
