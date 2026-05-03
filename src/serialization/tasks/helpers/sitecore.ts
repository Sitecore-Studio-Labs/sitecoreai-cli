import { readRootConfiguration } from "@/config";
import { ItemData } from "../../types";
import { executeSerializationCommands } from "../../sitecore-api";
import { Logger } from "@/shared/logger";
import { ItemCommand } from "../../commands";
import { resolveApiTimeoutMs } from "../shared";

export const applySitecoreCommands = async (
  root: ReturnType<typeof readRootConfiguration>,
  environmentName: string,
  database: string,
  commands: ItemCommand[],
  logger: Logger,
  whatIf?: boolean
): Promise<string[]> => {
  if (whatIf || commands.length === 0) {
    return [];
  }

  const toApiItemData = (item: ItemData) => ({
    id: item.id,
    parentId: item.parentId,
    templateId: item.templateId,
    database,
    path: item.path.toPathString(),
    name: item.name,
    branchId: item.branchId ?? undefined,
    sharedFields: item.sharedFields.map((field) => ({
      fieldId: field.fieldId,
      nameHint: field.nameHint,
      value: field.value ?? "",
      blobId: field.blobId ?? undefined,
    })),
    unversionedFields: item.unversionedFields.map((language) => ({
      language: language.language,
      fields: language.fields.map((field) => ({
        fieldId: field.fieldId,
        nameHint: field.nameHint,
        value: field.value ?? "",
        blobId: field.blobId ?? undefined,
      })),
    })),
    versions: item.versions.map((version) => ({
      language: version.language,
      version: version.version,
      fields: version.fields.map((field) => ({
        fieldId: field.fieldId,
        nameHint: field.nameHint,
        value: field.value ?? "",
        blobId: field.blobId ?? undefined,
      })),
    })),
  });

  const commandsByType = commands
    .map((command) => {
      const parentId = command.destination?.parentId ?? command.source.parentId;
      switch (command.type) {
        case "create":
          return {
            itemID: command.source.id,
            parentID: parentId,
            database,
            command: "CREATE",
            data: toApiItemData(command.sourceData ?? (command.source as ItemData)),
          };
        case "update":
          return {
            itemID: command.source.id,
            parentID: parentId,
            database,
            command: "UPDATE",
            data: toApiItemData(command.sourceData ?? (command.source as ItemData)),
          };
        case "move":
          return {
            itemID: command.source.id,
            parentID: parentId,
            database,
            command: "MOVE",
            data: command.source.parentId,
          };
        case "rename":
          return {
            itemID: command.source.id,
            parentID: parentId,
            database,
            command: "RENAME",
            data: command.source.path.itemName,
          };
        case "recycle":
          return {
            itemID: command.source.id,
            parentID: parentId,
            database,
            command: "RECYCLE",
            data: null,
          };
        default:
          return null;
      }
    })
    .filter(Boolean);

  const env = root.environments[environmentName];
  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const results = await executeSerializationCommands(env, commandsByType, "Information", {
    timeoutMs: apiTimeoutMs,
  });
  for (const result of results as Array<{
    success?: boolean;
    name?: string;
    messages?: Array<{ message: string; logLevel: string }>;
  }>) {
    if (result?.messages) {
      for (const message of result.messages) {
        logger.info(message.message);
      }
    }
  }

  return commands
    .filter((command) => command.type !== "recycle")
    .map((command) => command.source.id);
};
