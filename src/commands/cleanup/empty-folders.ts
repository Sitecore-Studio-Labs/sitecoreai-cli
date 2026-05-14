import { Command } from "commander";
import { runCleanupEmptyFolders } from "@/hygiene/tasks/cleanup-empty-folders";
import { withApplyGate } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupEmptyFoldersCommand = (): Command => {
  const command = new Command("empty-folders").description(
    "Delete folder-like items with no children, recursively bottom-up"
  );

  const purge = new Command("purge").description(
    "Walk --root depth-first and delete every item whose subtree is empty"
  );
  addCleanupBaseOptions(purge);
  purge.requiredOption("--root <path>", "Content root to clean up under");
  purge.option("--max-deletions <count>", "Cap on total deletions per run (default 500)", (v) =>
    parseInt(v, 10)
  );
  purge.action(withApplyGate(runCleanupEmptyFolders));
  command.addCommand(purge);
  return command;
};
