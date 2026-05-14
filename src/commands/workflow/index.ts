import { Command } from "commander";
import { createWorkflowAssignedCommand } from "./assigned";
import { createWorkflowInspectCommand } from "./inspect";
import { createWorkflowListCommandsCommand } from "./list-commands";
import { createWorkflowListDefsCommand } from "./list-defs";
import { createWorkflowStatusCommand } from "./status";

export const createWorkflowCommand = (): Command => {
  const command = new Command("workflow").description(
    "Inspect and operate on Sitecore workflows — current state, available commands, transitions"
  );

  command.addCommand(createWorkflowInspectCommand());
  command.addCommand(createWorkflowListCommandsCommand());
  command.addCommand(createWorkflowListDefsCommand());
  command.addCommand(createWorkflowStatusCommand());
  command.addCommand(createWorkflowAssignedCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai workflow inspect /sitecore/content/MySite/Home\n" +
      "  $ scai workflow inspect 110D559FDEA542EA9C1C8A5DF7E70EF9 --json\n" +
      "  $ scai workflow list-commands /sitecore/content/MySite/Home\n" +
      "  $ scai workflow list-defs\n" +
      "  $ scai workflow status --site <siteId>\n" +
      "  $ scai workflow assigned --state <stateId> --limit 100\n"
  );

  return command;
};
