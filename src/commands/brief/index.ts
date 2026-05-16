import { Command } from "commander";
import { createBriefListCommand } from "./list";
import { createBriefShowCommand } from "./show";
import { createBriefSetStatusCommand } from "./set-status";
import { createBriefTypesCommand } from "./types";
import { createBriefTodosCommand } from "./todos";
import { createBriefCommentsCommand } from "./comments";
import { createBriefDeleteCommand } from "./delete";
import { createBriefSyncCommand } from "./sync";

/**
 * `scai ops brief …` command family — Sitecore Content Operations Brief
 * API (`co-brief-api-<region>.sitecorecloud.io`).
 *
 * Surface:
 *   - `scai ops brief list`                            — list briefs in the tenant
 *   - `scai ops brief show <briefId>`                  — read one brief in detail
 *   - `scai ops brief set-status <briefId> <status>`   — move a brief's workflow status
 *   - `scai ops brief delete <briefId>`                — delete a brief
 *   - `scai ops brief types {list,get,create,update,delete}` — brief type CRUD
 *   - `scai ops brief sync {pull,diff,push}`           — brief type as a recipe
 *   - `scai ops brief todos [briefId]`                 — list to-dos
 *   - `scai ops brief comments {list,add}`             — list / post comments
 *
 * "Todo" is the Content Operations UI label for what the Brief API wire
 * calls `tasks`. Comment posting is wired UNVERIFIED — see `comments.ts`.
 */
export const createBriefCommand = (): Command => {
  const command = new Command("brief").description(
    "Briefs, brief types, to-dos, and comments on the Sitecore Content Operations Brief API."
  );

  command.addCommand(createBriefListCommand());
  command.addCommand(createBriefShowCommand());
  command.addCommand(createBriefSetStatusCommand());
  command.addCommand(createBriefDeleteCommand());
  command.addCommand(createBriefTypesCommand());
  command.addCommand(createBriefSyncCommand());
  command.addCommand(createBriefTodosCommand());
  command.addCommand(createBriefCommentsCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai ops brief list -n agents                      # list briefs\n" +
      "  $ scai ops brief show <briefId> -n agents            # read one brief\n" +
      "  $ scai ops brief set-status <briefId> Approved --apply  # move out of Draft\n" +
      "  $ scai ops brief delete <briefId> --apply --force    # delete a brief\n" +
      "  $ scai ops brief types list -n agents                # list brief schemas\n" +
      "  $ scai ops brief types create -f t.json --apply      # create a new schema\n" +
      "  $ scai ops brief sync pull --name CreativeBrief      # capture a type as a recipe\n" +
      "  $ scai ops brief todos <briefId> --assignees         # to-dos on a brief, with assignees\n" +
      "  $ scai ops brief comments list <briefId>             # comments on a brief\n" +
      '  $ scai ops brief comments add <briefId> --text "…" --apply  # post a comment\n'
  );

  return command;
};
