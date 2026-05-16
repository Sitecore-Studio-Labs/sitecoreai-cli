import { FilesystemPathProvider } from "../path-provider";
import { createFieldFilterSet } from "../field-filter";
import { ItemMetadata } from "../types";
import { fetchItemMetadata } from "../api/items";
import { loadFilesystemItems } from "../filesystem-store/items";
import { startSpinner } from "@/shared/spinner";
import {
  loadConfigAndModules,
  groupSubtreesByDatabase,
  resolveApiTimeoutMs,
  toLogger,
} from "./shared";
import { enrichCreateCommands, enrichUpdateCommands } from "../commands";
import type { SyncOptions } from "./types";
import { applyFilesystemCommands } from "./helpers/filesystem";
import { buildCommandsForDatabase } from "./helpers/commands";
import { buildItemDataMap } from "./helpers/items";
import { collectItemData } from "./helpers/collect";
import { syncRolesPull } from "./roles";
import { syncUsersPull } from "./users";

export const runPull = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const { root, modules } = await loadConfigAndModules(options);
  const envName = options.environmentName ?? root.defaultEnvironment;
  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const summary = {
    command: "serialization.pull",
    environment: envName,
    whatIf: Boolean(options.whatIf),
    totalChanges: 0,
    databases: [] as Array<{ database: string; changes: number; applied: boolean }>,
  };

  const subtreesByDb = groupSubtreesByDatabase(modules);
  for (const [database, subtrees] of subtreesByDb) {
    if (options.signal?.aborted) {
      options.emit?.({ kind: "database-skipped", database, reason: "cancelled-by-client" });
      break;
    }
    options.emit?.({ kind: "database-start", database, subtreeCount: subtrees.length });
    const spinner = await startSpinner(`Pulling ${database} items`);
    try {
      const sourceMetadata: ItemMetadata[] = [];
      for (const subtree of subtrees) {
        const filter = createFieldFilterSet(root.serialization.excludedFields, []);
        const metadata = await fetchItemMetadata(
          root.environments[envName],
          database,
          subtree.path.toPathString(),
          subtree.scope,
          filter,
          Boolean(options.useDebugSignatures),
          { timeoutMs: apiTimeoutMs }
        );
        sourceMetadata.push(...metadata.filter((item) => subtree.includesPath(item.path)));
      }

      const { items: destinationItems, metadata: destinationMetadata } =
        await loadFilesystemItems(subtrees);
      const commands = buildCommandsForDatabase(
        subtrees,
        sourceMetadata,
        destinationMetadata,
        false
      );
      const changes = commands.length;
      summary.totalChanges += changes;
      summary.databases.push({
        database,
        changes,
        applied: changes > 0 && !options.whatIf,
      });
      options.emit?.({ kind: "database-changes-detected", database, changes });

      if (changes === 0) {
        if (!logger.isJson()) {
          logger.info(`No changes detected for ${database}.`, "green");
        }
        spinner?.succeed();
        continue;
      }

      if (!logger.isJson()) {
        logger.info(`Discovered ${changes} changes for ${database}.`, "green");
      }
      if (options.whatIf) {
        if (!logger.isJson()) {
          logger.info("What if mode is active. No changes will be made.", "yellow");
        }
        spinner?.succeed();
        continue;
      }

      const dataMap = buildItemDataMap(
        (await collectItemData(envName, root, subtrees, Boolean(options.useDebugSignatures))).items
      );
      enrichCreateCommands(commands, dataMap);
      enrichUpdateCommands(commands, dataMap, buildItemDataMap(destinationItems), false);

      const pathProvider = new FilesystemPathProvider(subtrees);
      await applyFilesystemCommands(commands, pathProvider, dataMap, logger);
      options.emit?.({
        kind: "database-applied",
        database,
        changes,
        whatIf: Boolean(options.whatIf),
      });
      spinner?.succeed();
    } catch (error) {
      spinner?.fail();
      throw error;
    }
  }

  for (const module of modules) {
    await syncRolesPull(root, module, envName, logger);
    await syncUsersPull(root, module, envName, logger);
  }

  if (logger.isJson()) {
    logger.json(summary);
  }
};
