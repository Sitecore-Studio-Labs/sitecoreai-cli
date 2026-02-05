import { ItemData, ItemMetadata } from "./types";
import { AllowedPushOperations, FilesystemTreeSpec } from "./tree-spec";
import { compareItems, ItemComparisonResult } from "./compare";

export type ItemCommandType = "create" | "update" | "move" | "rename" | "recycle";

export type UpdateCommandData =
  | { command: "CHANGE_TEMPLATE"; data: string }
  | {
      command: "UPDATE";
      data: {
        fieldId: string;
        language?: string;
        version?: number;
        value: string;
        blobId?: string | null;
      };
    }
  | { command: "RESET_FIELD"; data: { fieldId: string; language?: string; version?: number } }
  | { command: "REMOVE_VERSION"; data: { language: string; version: number } }
  | { command: "ADD_VERSION"; data: { language: string; version: number } };

export type ItemCommand = {
  type: ItemCommandType;
  source: ItemMetadata;
  destination?: ItemMetadata;
  sourceData?: ItemData;
  updateCommands?: UpdateCommandData[];
};

const restrictedTemplateId = "AB86861A-6030-46C5-B394-E8F99E8B87DB";
const restrictedFieldId = "8CDC337E-A112-42FB-BBB4-4143751E123F";

const fieldResetAllowed = (item: ItemData, fieldId: string): boolean => {
  return (
    item.templateId.toUpperCase() !== restrictedTemplateId ||
    fieldId.toUpperCase() !== restrictedFieldId
  );
};

export const buildCommandsForSubtree = (
  subtree: FilesystemTreeSpec,
  sourceItems: ItemMetadata[],
  destinationItems: ItemMetadata[],
  applyAllowedPushOperations: boolean
): ItemCommand[] => {
  const commands: ItemCommand[] = [];

  const sourceMap = new Map(sourceItems.map((item) => [item.id, item]));
  const destinationMap = new Map(destinationItems.map((item) => [item.id, item]));

  for (const item of sourceItems) {
    const dest = destinationMap.get(item.id);
    const allowed = applyAllowedPushOperations
      ? subtree.getAllowedPushOperationsForItem(item.path)
      : AllowedPushOperations.CreateUpdateAndDelete;

    if (!dest) {
      commands.push({ type: "create", source: item });
      continue;
    }

    if (allowed !== AllowedPushOperations.CreateOnly) {
      if (item.parentId !== dest.parentId) {
        commands.push({ type: "move", source: item, destination: dest });
      }
      if (item.path.itemName !== dest.path.itemName) {
        commands.push({ type: "rename", source: item, destination: dest });
      }
      if (!item.dataSignature || !dest.dataSignature || item.dataSignature !== dest.dataSignature) {
        commands.push({ type: "update", source: item, destination: dest });
      }
    }
  }

  for (const dest of destinationItems) {
    if (sourceMap.has(dest.id)) {
      continue;
    }
    const allowed = applyAllowedPushOperations
      ? subtree.getAllowedPushOperationsForItem(dest.path)
      : AllowedPushOperations.CreateUpdateAndDelete;
    if (allowed === AllowedPushOperations.CreateUpdateAndDelete) {
      commands.push({ type: "recycle", source: dest });
    }
  }

  return orderCommands(commands);
};

export const buildUpdateCommandData = (
  comparison: ItemComparisonResult,
  push: boolean
): UpdateCommandData[] => {
  const updates: UpdateCommandData[] = [];

  if (comparison.isTemplateChanged) {
    updates.push({ command: "CHANGE_TEMPLATE", data: comparison.leftItem.templateId });
  }

  for (const version of comparison.changedVersions) {
    if (version.leftVersion && !version.rightVersion) {
      updates.push({
        command: "ADD_VERSION",
        data: { language: version.leftVersion.language, version: version.leftVersion.version },
      });
    }
    if (version.rightVersion && !version.leftVersion) {
      updates.push({
        command: "REMOVE_VERSION",
        data: { language: version.rightVersion.language, version: version.rightVersion.version },
      });
      continue;
    }

    for (const field of version.changedFields) {
      if (field.leftField) {
        updates.push({
          command: "UPDATE",
          data: {
            fieldId: field.leftField.fieldId,
            language: version.language,
            version: version.versionNumber,
            value: field.leftField.value ?? "",
            blobId: field.leftField.blobId ?? null,
          },
        });
      } else if (
        field.rightField &&
        (!push || fieldResetAllowed(comparison.rightItem, field.rightField.fieldId))
      ) {
        updates.push({
          command: "RESET_FIELD",
          data: {
            fieldId: field.rightField.fieldId,
            language: version.language,
            version: version.versionNumber,
          },
        });
      }
    }
  }

  for (const language of comparison.changedUnversionedFields) {
    for (const field of language.changedFields) {
      if (field.leftField) {
        updates.push({
          command: "UPDATE",
          data: {
            fieldId: field.leftField.fieldId,
            language: language.language.language,
            value: field.leftField.value ?? "",
            blobId: field.leftField.blobId ?? null,
          },
        });
      } else if (field.rightField) {
        updates.push({
          command: "RESET_FIELD",
          data: {
            fieldId: field.rightField.fieldId,
            language: language.language.language,
          },
        });
      }
    }
  }

  for (const field of comparison.changedSharedFields) {
    if (field.leftField) {
      updates.push({
        command: "UPDATE",
        data: {
          fieldId: field.leftField.fieldId,
          value: field.leftField.value ?? "",
          blobId: field.leftField.blobId ?? null,
        },
      });
    } else if (field.rightField) {
      updates.push({
        command: "RESET_FIELD",
        data: { fieldId: field.rightField.fieldId },
      });
    }
  }

  return updates;
};

export const enrichUpdateCommands = (
  commands: ItemCommand[],
  sourceData: Map<string, ItemData>,
  destinationData: Map<string, ItemData>,
  push: boolean
): void => {
  for (const command of commands) {
    if (command.type !== "update") {
      continue;
    }

    const source = sourceData.get(command.source.id);
    const dest = destinationData.get(command.source.id);
    if (!source || !dest) {
      continue;
    }

    const comparison = compareItems(source, dest);
    command.sourceData = source;
    command.updateCommands = buildUpdateCommandData(comparison, push);
  }
};

export const enrichCreateCommands = (
  commands: ItemCommand[],
  sourceData: Map<string, ItemData>
): void => {
  for (const command of commands) {
    if (command.type !== "create") {
      continue;
    }
    command.sourceData = sourceData.get(command.source.id);
  }
};

const orderCommands = (commands: ItemCommand[]): ItemCommand[] => {
  const depth = (item: ItemMetadata): number => item.path.count;
  const createUpdateMoveRename = commands.filter((cmd) => cmd.type !== "recycle");
  const recycle = commands.filter((cmd) => cmd.type === "recycle");

  createUpdateMoveRename.sort((a, b) => depth(a.source) - depth(b.source));
  recycle.sort((a, b) => depth(b.source) - depth(a.source));

  const standardValues = createUpdateMoveRename.filter(
    (command) =>
      command.type === "create" && command.source.path.toPathString().includes("__Standard Values")
  );
  const rest = createUpdateMoveRename.filter((command) => !standardValues.includes(command));

  return [...rest, ...standardValues, ...recycle];
};
