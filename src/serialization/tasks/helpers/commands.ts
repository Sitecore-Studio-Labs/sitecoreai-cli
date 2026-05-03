import { FilesystemTreeSpec } from "../../tree-spec";
import { ItemMetadata } from "../../types";
import { buildCommandsForSubtree, ItemCommand } from "../../commands";

export const buildCommandsForDatabase = (
  subtrees: FilesystemTreeSpec[],
  sourceMetadata: ItemMetadata[],
  destinationMetadata: ItemMetadata[],
  applyAllowedPushOperations: boolean
): ItemCommand[] => {
  const commands: ItemCommand[] = [];
  for (const subtree of subtrees) {
    const source = sourceMetadata.filter((item) => subtree.includesPath(item.path));
    const destination = destinationMetadata.filter((item) => subtree.includesPath(item.path));
    commands.push(
      ...buildCommandsForSubtree(subtree, source, destination, applyAllowedPushOperations)
    );
  }
  return commands;
};
