import { Command } from "commander";
import { createCleanupVersionsCommand } from "./versions";

export const createCleanupCommand = (): Command => {
  const command = new Command("cleanup").description(
    "Mutating hygiene operations — prune version history, etc. Honours --what-if and --allow-write."
  );

  command.addCommand(createCleanupVersionsCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai cleanup versions prune --root /sitecore/content/MySite --keep 5 --what-if\n" +
      "  $ scai cleanup versions prune --root /sitecore/content/MySite --keep 5 --allow-write\n"
  );

  return command;
};
