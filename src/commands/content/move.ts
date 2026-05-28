import { Command } from "commander";
import { runContentMove } from "@/content/tasks/move";
import { withApplyGate } from "../shared";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createContentMoveCommand = (): Command => {
  const command = new Command("move")
    .description(
      "Move a Sitecore item to a new parent — preserves itemId, name, and all inbound references. Wraps the Authoring `moveItem` mutation; the only safe alternative to delete + recreate when relocating items."
    )
    .option("--item-id <guid>", "Source item GUID. Mutually exclusive with --path.")
    .option("--path <path>", "Source item content-tree path. Mutually exclusive with --item-id.")
    .option("--to-item-id <guid>", "Destination parent GUID. Mutually exclusive with --to-path.")
    .option(
      "--to-path <path>",
      "Destination parent content-tree path. Mutually exclusive with --to-item-id."
    );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(
    withApplyGate(
      async (options: {
        itemId?: string;
        path?: string;
        toItemId?: string;
        toPath?: string;
        whatIf?: boolean;
        allowWrite?: boolean;
      }) => {
        await runContentMove(options);
      }
    )
  );

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai content move --path /sitecore/content/MySite/OldHome --to-path /sitecore/content/Archive --what-if\n" +
      "  $ scai content move --item-id <guid> --to-item-id <parent-guid> --allow-write\n"
  );

  return command;
};
