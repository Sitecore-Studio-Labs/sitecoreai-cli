import { Command } from "commander";
import { createWorkflowInspectCommand } from "./inspect";
import { createWorkflowListCommandsCommand } from "./list-commands";

export const createWorkflowCommand = (): Command => {
  const command = new Command("workflow").description(
    "Inspect and operate on Sitecore workflows — current state, available commands, transitions"
  );

  command.addCommand(createWorkflowInspectCommand());
  command.addCommand(createWorkflowListCommandsCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai workflow inspect /sitecore/content/MySite/Home\n" +
      "  $ scai workflow inspect 110D559FDEA542EA9C1C8A5DF7E70EF9 --json\n" +
      "  $ scai workflow list-commands /sitecore/content/MySite/Home\n"
  );

  return command;
};
