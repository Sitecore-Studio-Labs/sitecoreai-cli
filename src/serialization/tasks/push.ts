import { createFieldFilterSet } from "../field-filter";
import { ItemMetadata } from "../types";
import { fetchItemMetadata, publishItems } from "../sitecore-api";
import { loadFilesystemItems } from "../filesystem-store";
import { startSpinner } from "@/shared/spinner";
import {
  ensureAllowWrite,
  groupSubtreesByDatabase,
  loadConfigAndModules,
  resolveApiTimeoutMs,
  toLogger,
} from "./shared";
import { enrichCreateCommands, enrichUpdateCommands } from "../commands";
import type { SyncOptions } from "./types";
import {
  applySitecoreCommands,
  buildCommandsForDatabase,
  buildItemDataMap,
  collectItemData,
} from "./helpers";
import { syncRolesPush } from "./roles";
import { syncUsersPush } from "./users";

export const runPush = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const { root, modules } = await loadConfigAndModules(options);
  const envName = options.environmentName ?? root.defaultEnvironment;
  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const summary = {
    command: "serialization.push",
    environment: envName,
    whatIf: Boolean(options.whatIf),
    totalChanges: 0,
    publishedCount: 0,
    databases: [] as Array<{
      database: string;
      changes: number;
      applied: boolean;
      published: boolean;
    }>,
  };

  if (options.allowWrite) {
    const env = root.environments[envName];
    if (env) {
      env.allowWrite = true;
    }
  }

  if (!options.whatIf) {
    ensureAllowWrite(root, envName);
  }

  const subtreesByDb = groupSubtreesByDatabase(modules);
  for (const [database, subtrees] of subtreesByDb) {
    const spinner = await startSpinner(`Pushing ${database} items`);
    try {
      const { items: sourceItems, metadata: sourceMetadata } = await loadFilesystemItems(subtrees);
      const destinationMetadata: ItemMetadata[] = [];
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
        destinationMetadata.push(...metadata.filter((item) => subtree.includesPath(item.path)));
      }

      const commands = buildCommandsForDatabase(
        subtrees,
        sourceMetadata,
        destinationMetadata,
        true
      );
      const changes = commands.length;
      summary.totalChanges += changes;
      const summaryEntry = {
        database,
        changes,
        applied: changes > 0 && !options.whatIf,
        published: false,
      };
      if (changes === 0) {
        if (!logger.isJson()) {
          logger.info(`No changes detected for ${database}.`, "green");
        }
        spinner?.succeed();
        summary.databases.push(summaryEntry);
        continue;
      }
      if (options.whatIf && !logger.isJson()) {
        logger.info("What if mode is active. No changes will be made.", "yellow");
      }

      const sourceDataMap = buildItemDataMap(sourceItems);
      const destData = await collectItemData(
        envName,
        root,
        subtrees,
        Boolean(options.useDebugSignatures)
      );
      const destDataMap = buildItemDataMap(destData.items);
      enrichCreateCommands(commands, sourceDataMap);
      enrichUpdateCommands(commands, sourceDataMap, destDataMap, true);

      const processedIds = await applySitecoreCommands(
        root,
        envName,
        database,
        commands,
        logger,
        options.whatIf
      );

      if (options.publish && processedIds.length > 0 && !options.whatIf) {
        const targets =
          options.targets && options.targets.length > 0 ? options.targets : [undefined];
        for (const target of targets) {
          await publishItems(root.environments[envName], processedIds, target, {
            timeoutMs: apiTimeoutMs,
          });
        }
        summaryEntry.published = true;
        summary.publishedCount += processedIds.length;
        if (!logger.isJson()) {
          logger.info("Publishing is finished.", "green");
        }
      }
      spinner?.succeed();
      summary.databases.push(summaryEntry);
    } catch (error) {
      spinner?.fail();
      throw error;
    }
  }

  for (const module of modules) {
    await syncRolesPush(root, module, envName, logger);
    await syncUsersPush(root, module, envName, logger);
  }

  if (logger.isJson()) {
    logger.json(summary);
  }
};
