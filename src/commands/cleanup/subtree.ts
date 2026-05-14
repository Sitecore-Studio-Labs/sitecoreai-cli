import { Command } from "commander";
import { runCleanupSubtree } from "@/hygiene/tasks/cleanup-subtree";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupSubtreeCommand = (): Command => {
  const command = new Command("subtree").description(
    "Delete a Sitecore subtree bottom-up, with hard-block on external inbound references"
  );

  const del = new Command("delete").description(
    "Walk a subtree leaf-first and delete every descendant + the root"
  );
  addCleanupBaseOptions(del);
  del.requiredOption("--path <content-tree-path>", "Subtree root to delete");
  del.option(
    "--scan-root <path>",
    "Content root to scan for inbound references (default: /sitecore — the entire CMS)"
  );
  del.option(
    "--orphan-external-refs <mode>",
    "How to handle external items whose fields reference the subtree. Default: refuse. 'clear' empties the entire referring field. 'prune' surgically removes only the entries pointing at the subtree (preserves sibling values in multi-list / treelist fields and `<r>` elements in `__Renderings` layout XML)."
  );
  del.option(
    "--max-deletions <count>",
    "Hard cap on items deleted in one run (default: 1000)",
    (v) => parseInt(v, 10)
  );
  del.option("--index <name>", "Override the search index name (default: sitecore_master_index)");
  del.option(
    "--fields <name>",
    "Restrict inbound-ref scan to these field names. Repeat or comma-separate.",
    (v: string, prev: string[] = []) =>
      prev.concat(
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      ),
    [] as string[]
  );
  del.action(async (options) => {
    await runCleanupSubtree(options);
  });

  command.addCommand(del);
  return command;
};
