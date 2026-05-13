import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs/promises";
import { createScaiError } from "@/shared/errors";
import { FilesystemTreeSpec } from "../tree-spec";
import { ItemData, ItemMetadata } from "../types";
import { readItemYaml, writeItemYaml } from "../yaml";
import { FilesystemPathProvider } from "../path-provider";
import { createDataSignatureBase, createSignature } from "../signature";

export const loadFilesystemItems = async (
  subtrees: FilesystemTreeSpec[]
): Promise<{ items: ItemData[]; metadata: ItemMetadata[] }> => {
  const results: ItemData[] = [];

  for (const subtree of subtrees) {
    const files = await fg("**/*.yml", {
      cwd: subtree.physicalPath,
      absolute: true,
      onlyFiles: true,
    });

    for (const file of files) {
      const item = await readItemYaml(file);
      if (!subtree.includesPath(item.path)) {
        continue;
      }
      if (!item.database) {
        item.database = subtree.database;
      }
      if (!item.dataSignature) {
        const base = createDataSignatureBase(item);
        item.dataSignature = createSignature(base) ?? "";
      }
      results.push(item);
    }
  }

  const metadata = results.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    templateId: item.templateId,
    path: item.path,
    dataSignature: item.dataSignature,
  }));

  return { items: results, metadata };
};

export const writeItemToFilesystem = async (
  pathProvider: FilesystemPathProvider,
  item: ItemData
): Promise<string> => {
  const targetPath = pathProvider.getPhysicalPathForItemPath(item.path, ".yml");
  if (!targetPath) {
    throw createScaiError(`Unable to resolve file path for ${item.path}`, "INPUT_INVALID");
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const content = writeItemYaml(item);
  await fs.writeFile(targetPath, content, "utf8");
  return targetPath;
};

export const removeItemFromFilesystem = async (
  pathProvider: FilesystemPathProvider,
  item: ItemMetadata
): Promise<void> => {
  const targetPath = pathProvider.getPhysicalPathForItemPath(item.path, ".yml");
  if (!targetPath) {
    return;
  }
  await fs.rm(targetPath, { force: true });
};
