import { Command } from "commander";
import { createCleanupArchiveCommand } from "./archive";
import { createCleanupDeadTemplatesCommand } from "./dead-templates";
import { createCleanupDuplicatesCommand } from "./duplicates";
import { createCleanupEmptyFoldersCommand } from "./empty-folders";
import { createCleanupFieldSetCommand } from "./field-set";
import { createCleanupFindReplaceCommand } from "./find-replace";
import { createCleanupLanguageVersionsCommand } from "./language-versions";
import { createCleanupRenameCommand } from "./rename";
import { createCleanupRolesCommand } from "./roles";
import { createCleanupSiteResidueCommand } from "./site-residue";
import { createCleanupSlugConflictsCommand } from "./slug-conflicts";
import { createCleanupSubtreeCommand } from "./subtree";
import { createCleanupUsersCommand } from "./users";
import { createCleanupVersionsCommand } from "./versions";
import { createCleanupWorkflowCommand } from "./workflow";

export const createCleanupCommand = (): Command => {
  const command = new Command("cleanup").description(
    "Mutating hygiene operations — versions, archive, templates, duplicates, find-replace, workflow, folders, roles, users. Honours --what-if and --allow-write."
  );

  command.addCommand(createCleanupArchiveCommand());
  command.addCommand(createCleanupDeadTemplatesCommand());
  command.addCommand(createCleanupDuplicatesCommand());
  command.addCommand(createCleanupEmptyFoldersCommand());
  command.addCommand(createCleanupFieldSetCommand());
  command.addCommand(createCleanupFindReplaceCommand());
  command.addCommand(createCleanupLanguageVersionsCommand());
  command.addCommand(createCleanupRenameCommand());
  command.addCommand(createCleanupRolesCommand());
  command.addCommand(createCleanupSiteResidueCommand());
  command.addCommand(createCleanupSlugConflictsCommand());
  command.addCommand(createCleanupSubtreeCommand());
  command.addCommand(createCleanupUsersCommand());
  command.addCommand(createCleanupVersionsCommand());
  command.addCommand(createCleanupWorkflowCommand());

  command.addHelpText(
    "after",
    "\nNote: after a large cascade delete the Authoring API template-cache\n" +
      "can lag ~30-90s. `dead-templates purge` auto-retries past the settle\n" +
      "window — only an unusually long lag needs a manual re-run.\n" +
      "\nExamples (each subcommand's --help has its full set):\n" +
      "  $ scai hygiene cleanup versions prune --root /sitecore/content/MySite --keep 5 --what-if\n" +
      "  $ scai hygiene cleanup duplicates purge --root /sitecore/content/MySite --keep-rule oldest --what-if\n" +
      "  $ scai hygiene cleanup dead-templates purge --root /sitecore/templates/Project --what-if\n" +
      "  $ scai hygiene cleanup subtree delete --path /sitecore/content/MySite/Old --what-if\n" +
      "  $ scai hygiene cleanup site-residue purge --what-if\n"
  );

  return command;
};
