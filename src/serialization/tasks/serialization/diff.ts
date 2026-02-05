import path from "node:path";
import { ItemPath } from "../../item-path";
import { FilesystemTreeSpec, AllowedPushOperations, TreeScope } from "../../tree-spec";
import { createFieldFilterSet } from "../../field-filter";
import { ItemMetadata } from "../../types";
import { fetchItemMetadata } from "../../sitecore-api";
import { enrichCreateCommands, enrichUpdateCommands } from "../../commands";
import {
  groupSubtreesByDatabase,
  loadConfigAndModules,
  resolveApiTimeoutMs,
  toLogger,
  ensureAllowWrite,
} from "../shared";
import type { DiffOptions } from "../types";
import {
  applySitecoreCommands,
  buildCommandsForDatabase,
  buildItemDataMap,
  collectItemData,
} from "./helpers";

export const runDiff = async (options: DiffOptions): Promise<void> => {
  const logger = toLogger(options);
  const { root, modules } = await loadConfigAndModules(options);
  const sourceName = options.source ?? root.defaultEnvironment;
  const destName = options.destination ?? root.defaultEnvironment;
  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const summary = {
    command: "serialization.diff",
    source: sourceName,
    destination: destName,
    path: options.path ?? null,
    push: Boolean(options.push),
    totalDifferences: 0,
    databases: [] as Array<{ database: string; differences: number; applied: boolean }>,
  };

  if (options.path) {
    const sourceDatabase = options.sourceDatabase ?? "master";
    const destinationDatabase = options.destinationDatabase ?? sourceDatabase;
    const subtree = new FilesystemTreeSpec();
    subtree.name = "diff";
    subtree.database = destinationDatabase;
    subtree.path = ItemPath.fromPathString(options.path);
    subtree.scope = TreeScope.ItemAndChildren;
    subtree.allowedPushOperations = AllowedPushOperations.CreateUpdateAndDelete;
    subtree.physicalPath = path.join(process.cwd(), "diff");

    const filter = createFieldFilterSet(root.serialization.excludedFields, []);
    const sourceMetadata = await fetchItemMetadata(
      root.environments[sourceName],
      sourceDatabase,
      subtree.path.toPathString(),
      subtree.scope,
      filter,
      false,
      { timeoutMs: apiTimeoutMs }
    );
    const destMetadata = await fetchItemMetadata(
      root.environments[destName],
      destinationDatabase,
      subtree.path.toPathString(),
      subtree.scope,
      filter,
      false,
      { timeoutMs: apiTimeoutMs }
    );
    const sourceFiltered = sourceMetadata.filter((item) => subtree.includesPath(item.path));
    const destFiltered = destMetadata.filter((item) => subtree.includesPath(item.path));
    const commands = buildCommandsForDatabase([subtree], sourceFiltered, destFiltered, true);
    const differences = commands.length;
    summary.totalDifferences += differences;
    summary.databases.push({
      database: destinationDatabase,
      differences,
      applied: Boolean(options.push),
    });
    if (!logger.isJson()) {
      logger.info(`Discovered ${differences} differences for ${destinationDatabase}.`, "green");
    }

    if (options.push) {
      ensureAllowWrite(root, destName);
      const sourceData = await collectItemData(sourceName, root, [subtree], false);
      const destData = await collectItemData(destName, root, [subtree], false);
      const sourceDataMap = buildItemDataMap(sourceData.items);
      const destDataMap = buildItemDataMap(destData.items);
      enrichCreateCommands(commands, sourceDataMap);
      enrichUpdateCommands(commands, sourceDataMap, destDataMap, true);
      await applySitecoreCommands(root, destName, destinationDatabase, commands, logger, false);
    }

    if (logger.isJson()) {
      logger.json(summary);
    }
    return;
  }

  const subtreesByDb = groupSubtreesByDatabase(modules);
  for (const [database, subtrees] of subtreesByDb) {
    const sourceMetadata: ItemMetadata[] = [];
    const destinationMetadata: ItemMetadata[] = [];
    for (const subtree of subtrees) {
      const filter = createFieldFilterSet(root.serialization.excludedFields, []);
      const source = await fetchItemMetadata(
        root.environments[sourceName],
        database,
        subtree.path.toPathString(),
        subtree.scope,
        filter,
        false,
        { timeoutMs: apiTimeoutMs }
      );
      const dest = await fetchItemMetadata(
        root.environments[destName],
        database,
        subtree.path.toPathString(),
        subtree.scope,
        filter,
        false,
        { timeoutMs: apiTimeoutMs }
      );
      sourceMetadata.push(...source.filter((item) => subtree.includesPath(item.path)));
      destinationMetadata.push(...dest.filter((item) => subtree.includesPath(item.path)));
    }

    const commands = buildCommandsForDatabase(subtrees, sourceMetadata, destinationMetadata, true);
    const differences = commands.length;
    summary.totalDifferences += differences;
    summary.databases.push({
      database,
      differences,
      applied: Boolean(options.push),
    });
    if (!logger.isJson()) {
      logger.info(`Discovered ${differences} differences for ${database}.`, "green");
    }

    if (!options.push) {
      continue;
    }

    ensureAllowWrite(root, destName);
    const sourceData = await collectItemData(sourceName, root, subtrees, false);
    const destData = await collectItemData(destName, root, subtrees, false);
    const sourceDataMap = buildItemDataMap(sourceData.items);
    const destDataMap = buildItemDataMap(destData.items);
    enrichCreateCommands(commands, sourceDataMap);
    enrichUpdateCommands(commands, sourceDataMap, destDataMap, true);
    await applySitecoreCommands(root, destName, database, commands, logger, false);
  }

  if (logger.isJson()) {
    logger.json(summary);
  }
};
