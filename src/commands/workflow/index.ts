import { Command } from "commander";
import { createWorkflowAdvanceCommand } from "./advance";
import { createWorkflowApplyCommand } from "./apply";
import { createWorkflowAssignedCommand } from "./assigned";
import { createWorkflowInspectCommand } from "./inspect";
import { createWorkflowListCommandsCommand } from "./list-commands";
import { createWorkflowListDefsCommand } from "./list-defs";
import { createWorkflowResetCommand } from "./reset";
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
  command.addCommand(createWorkflowAdvanceCommand());
  command.addCommand(createWorkflowResetCommand());
  command.addCommand(createWorkflowApplyCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai content workflow inspect 'Blog Article Approval'   # by display name\n" +
      "  $ scai content workflow inspect /sitecore/content/MySite/Home\n" +
      "  $ scai content workflow list-commands /sitecore/content/MySite/Home\n" +
      "  $ scai content workflow list-defs\n" +
      "  $ scai content workflow status --site <siteId>\n" +
      "  $ scai content workflow assigned --state <stateId> --limit 100\n" +
      "  $ scai content workflow advance /sitecore/content/MySite/Home --command Approve\n" +
      "  $ scai content workflow reset /sitecore/content/MySite/Home --what-if\n" +
      "  $ scai content workflow apply /sitecore/content/MySite/Home --workflow 'Blog Article Approval'\n"
  );

  return command;
};
