import { Command } from "commander";
import { runWorkflowAdvance } from "@/workflow/tasks/advance";
import { addAllowWriteOption, addWhatIfOption } from "../shared";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowAdvanceCommand = (): Command => {
  const command = new Command("advance")
    .description(
      "Advance a single item through one workflow transition (counterpart to the cleanup batch sweep)"
    )
    .argument("<item>", "Item GUID or content-tree path")
    .requiredOption(
      "--command <name>",
      "Workflow command display name (e.g. 'Submit', 'Approve'); matched case-insensitively against commands available at the item's current state"
    )
    .option("--comments <text>", "Comment recorded with the transition (audit trail)")
    .action(async (item: string, options: Record<string, unknown>) => {
      await runWorkflowAdvance({ ...options, item } as never);
    });
  addWorkflowReadOptions(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  return command;
};
