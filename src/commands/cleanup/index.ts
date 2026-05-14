import { Command } from "commander";
import { createCleanupArchiveCommand } from "./archive";
import { createCleanupDeadTemplatesCommand } from "./dead-templates";
import { createCleanupDuplicatesCommand } from "./duplicates";
import { createCleanupEmptyFoldersCommand } from "./empty-folders";
import { createCleanupFieldSetCommand } from "./field-set";
import { createCleanupFindReplaceCommand } from "./find-replace";
import { createCleanupLanguageVersionsCommand } from "./language-versions";
import { createCleanupPublishCommand } from "./publish";
import { createCleanupRenameCommand } from "./rename";
import { createCleanupRolesCommand } from "./roles";
import { createCleanupSiteResidueCommand } from "./site-residue";
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
  command.addCommand(createCleanupPublishCommand());
  command.addCommand(createCleanupRenameCommand());
  command.addCommand(createCleanupRolesCommand());
  command.addCommand(createCleanupSiteResidueCommand());
  command.addCommand(createCleanupUsersCommand());
  command.addCommand(createCleanupVersionsCommand());
  command.addCommand(createCleanupWorkflowCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai cleanup versions prune --root /sitecore/content/MySite --keep 5 --what-if\n" +
      "  $ scai cleanup versions archive --root /sitecore/content/MySite --keep 5 --allow-write\n" +
      "  $ scai cleanup archive purge --older-than-days 30 --allow-write\n" +
      "  $ scai cleanup dead-templates purge --root /sitecore/templates/Project --what-if\n" +
      "  $ scai cleanup duplicates purge --root /sitecore/content/MySite --keep-rule oldest --what-if\n" +
      "  $ scai cleanup workflow advance --root /sitecore/content/MySite --command-name Submit --stale-days 60 --what-if\n" +
      "  $ scai cleanup workflow apply --root /sitecore/content/MySite --workflow 'Article Workflow' --template /sitecore/templates/Foundation/Article --what-if\n" +
      "  $ scai cleanup empty-folders purge --root /sitecore/content/MySite --what-if\n" +
      "  $ scai cleanup roles purge-empty --domain sitecore --what-if\n" +
      "  $ scai cleanup site-residue purge --what-if\n" +
      "  $ scai cleanup users purge-stale --not-active-days 365 --what-if\n"
  );

  return command;
};
