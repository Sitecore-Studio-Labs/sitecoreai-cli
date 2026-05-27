import { Command } from "commander";
import { runCleanupMultilistRemoveRef } from "@/hygiene/tasks/cleanup/multilist-remove-ref";
import { withApplyGate } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupMultilistCommand = (): Command => {
  const command = new Command("multilist").description(
    "Surgical multilist-field edits — promoted from `scai/scripting/helpers/multilist.ts` so they're reachable without an entry script"
  );

  const removeRef = new Command("remove-ref").description(
    "Remove one GUID from a multilist / treelist / droplink-list field on a single item. Case-insensitive, brace-tolerant. Use --what-if first to see the before/after."
  );
  addCleanupBaseOptions(removeRef);
  removeRef.requiredOption("--item-id <guid>", "Target item GUID (with or without braces)");
  removeRef.requiredOption(
    "--field <name>",
    "Field name to mutate (must be a multilist-shaped field)"
  );
  removeRef.requiredOption("--ref <guid>", "GUID to remove from the field");
  removeRef.option("--language <code>", "Sitecore language code (e.g. en, en-US, fr-CA)");
  removeRef.action(
    withApplyGate(
      async (options: {
        itemId: string;
        field: string;
        ref: string;
        language?: string;
        allowWrite?: boolean;
        whatIf?: boolean;
      }) => {
        await runCleanupMultilistRemoveRef({
          ...options,
          fieldName: options.field,
          refToRemove: options.ref,
        });
      }
    )
  );

  command.addCommand(removeRef);
  return command;
};
