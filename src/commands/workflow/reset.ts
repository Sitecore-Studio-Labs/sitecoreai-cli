import { Command } from "commander";
import { runWorkflowReset } from "@/workflow/tasks";
import { addAllowWriteOption, addWhatIfOption } from "../shared";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowResetCommand = (): Command => {
  const command = new Command("reset")
    .description(
      "Force an item back to its workflow's initial state via direct __Workflow state field write. Bypasses validation + submit actions — use as an admin escape hatch, not a routine transition."
    )
    .argument("<item>", "Item GUID or content-tree path")
    .action(async (item: string, options: Record<string, unknown>) => {
      await runWorkflowReset({ ...options, item } as never);
    });
  addWorkflowReadOptions(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  return command;
};
