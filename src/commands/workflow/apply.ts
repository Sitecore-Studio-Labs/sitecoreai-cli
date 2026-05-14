import { Command } from "commander";
import { runWorkflowApply } from "@/workflow/tasks";
import { addAllowWriteOption, addWhatIfOption } from "../shared";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowApplyCommand = (): Command => {
  const command = new Command("apply")
    .description(
      "Attach a workflow to an item (sets __Workflow + __Workflow state directly). Bypasses the workflow engine — use for content authored before the workflow existed or to recover orphaned items."
    )
    .argument("<item>", "Item GUID or content-tree path")
    .requiredOption(
      "--workflow <ref>",
      "Workflow GUID, content-tree path, or display/item name (case-insensitive)"
    )
    .option(
      "--state <ref>",
      "Override the target state (GUID or name). Defaults to the workflow's __Initial state."
    )
    .action(async (item: string, options: Record<string, unknown>) => {
      await runWorkflowApply({ ...options, item } as never);
    });
  addWorkflowReadOptions(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  return command;
};
