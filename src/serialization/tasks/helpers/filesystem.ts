import { FilesystemPathProvider } from "../../path-provider";
import { ItemData } from "../../types";
import { removeItemFromFilesystem, writeItemToFilesystem } from "../../filesystem-store/items";
import { Logger } from "../../../shared/logger";
import { ItemCommand } from "../../commands";

export const applyFilesystemCommands = async (
  commands: ItemCommand[],
  pathProvider: FilesystemPathProvider,
  sourceData: Map<string, ItemData>,
  logger: Logger
): Promise<string[]> => {
  const processedIds: string[] = [];

  for (const command of commands) {
    if (command.type === "recycle") {
      await removeItemFromFilesystem(pathProvider, command.source);
      logger.info(command.source.path.toPathString(), "yellow");
      continue;
    }

    const itemData = command.sourceData ?? sourceData.get(command.source.id);
    if (!itemData) {
      continue;
    }

    if (command.type === "move" || command.type === "rename") {
      if (command.destination) {
        await removeItemFromFilesystem(pathProvider, command.destination);
      }
    }

    await writeItemToFilesystem(pathProvider, itemData);
    processedIds.push(itemData.id);
  }

  return processedIds;
};
