import { Command } from "commander";
import { createBriefListCommand } from "./list";
import { createBriefShowCommand } from "./show";
import { createBriefSetStatusCommand } from "./set-status";
import { createBriefTypesCommand } from "./types";
import { createBriefTasksCommand } from "./tasks";
import { createBriefCommentsCommand } from "./comments";
import { createBriefSyncCommand } from "./sync";

/**
 * `scai ops brief …` command family — read-only access to the Sitecore
 * Content Operations Brief API (`co-brief-api-<region>.sitecorecloud.io`).
 *
 * v1 surface:
 *   - `scai ops brief list`                            — list briefs in the tenant
 *   - `scai ops brief show <briefId>`                  — read one brief in detail
 *   - `scai ops brief types {list,get,create,update,delete}` — brief type CRUD
 *   - `scai ops brief sync {pull,diff,push}`           — brief type as a recipe
 *   - `scai ops brief tasks [briefId]`                 — list tasks
 *   - `scai ops brief comments [briefId]`              — list comments
 *
 * Brief instance writes (`createBrief` etc.) exist in the SDK but aren't
 * exposed at the CLI yet — they're wired but not smoke-tested end-to-end.
 */
export const createBriefCommand = (): Command => {
  const command = new Command("brief").description(
    "Read briefs, brief types, tasks, and comments from the Sitecore Content Operations Brief API."
  );

  command.addCommand(createBriefListCommand());
  command.addCommand(createBriefShowCommand());
  command.addCommand(createBriefSetStatusCommand());
  command.addCommand(createBriefTypesCommand());
  command.addCommand(createBriefSyncCommand());
  command.addCommand(createBriefTasksCommand());
  command.addCommand(createBriefCommentsCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai ops brief list -n agents                      # list briefs\n" +
      "  $ scai ops brief show <briefId> -n agents            # read one brief\n" +
      "  $ scai ops brief set-status <briefId> Approved --apply  # move out of Draft\n" +
      "  $ scai ops brief types list -n agents                # list brief schemas\n" +
      "  $ scai ops brief types get <id> -n agents            # read one schema\n" +
      "  $ scai ops brief types create -f t.json --apply      # create a new schema\n" +
      "  $ scai ops brief sync pull --name CreativeBrief      # capture a type as a recipe\n" +
      "  $ scai ops brief sync push -f brief.yaml --allow-write  # converge a type onto a recipe\n" +
      "  $ scai ops brief tasks <briefId> --assignees         # tasks on a brief, with assignees\n" +
      "  $ scai ops brief comments <briefId>                  # comments on a brief\n"
  );

  return command;
};
