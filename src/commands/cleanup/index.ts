import { Command } from "commander";
import { createCleanupArchiveCommand } from "./archive";
import { createCleanupDeadTemplatesCommand } from "./dead-templates";
import { createCleanupDuplicatesCommand } from "./duplicates";
import { createCleanupVersionsCommand } from "./versions";

export const createCleanupCommand = (): Command => {
  const command = new Command("cleanup").description(
    "Mutating hygiene operations — versions, archive, dead templates, duplicates. Honours --what-if and --allow-write."
  );

  command.addCommand(createCleanupArchiveCommand());
  command.addCommand(createCleanupDeadTemplatesCommand());
  command.addCommand(createCleanupDuplicatesCommand());
  command.addCommand(createCleanupVersionsCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai cleanup versions prune --root /sitecore/content/MySite --keep 5 --what-if\n" +
      "  $ scai cleanup versions archive --root /sitecore/content/MySite --keep 5 --allow-write\n" +
      "  $ scai cleanup archive purge --older-than-days 30 --allow-write\n" +
      "  $ scai cleanup dead-templates purge --root /sitecore/templates/Project --what-if\n" +
      "  $ scai cleanup duplicates purge --root /sitecore/content/MySite --keep-rule oldest --what-if\n"
  );

  return command;
};
