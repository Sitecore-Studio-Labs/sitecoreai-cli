import { createFieldFilterSet } from "../field-filter";
import { ItemMetadata } from "../types";
import type { FilesystemTreeSpec } from "../tree-spec";
import { fetchItemMetadata } from "../api/items";
import { publishItems } from "../api/publish";
import { loadFilesystemItems } from "../filesystem-store/items";
import { buildScaiEnvelope } from "@/shared/envelope";
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
import { applySitecoreCommands } from "./helpers/sitecore";
import { buildCommandsForDatabase } from "./helpers/commands";
import { buildItemDataMap } from "./helpers/items";
import { collectItemData } from "./helpers/collect";
import { syncRolesPush } from "./roles";
import { syncUsersPush } from "./users";
import type { RootConfiguration } from "@/config/types";

type PushSummaryEntry = {
  database: string;
  changes: number;
  applied: boolean;
  published: boolean;
};

type PushSummary = {
  command: string;
  environment: string;
  whatIf: boolean;
  totalChanges: number;
  publishedCount: number;
  databases: PushSummaryEntry[];
};

interface PushDatabaseContext {
  root: RootConfiguration;
  envName: string;
  apiTimeoutMs: number | undefined;
  options: SyncOptions;
  logger: ReturnType<typeof toLogger>;
  summary: PushSummary;
}

/** Fetch destination metadata for every subtree in a database. */
const fetchDestinationMetadata = async (
  ctx: PushDatabaseContext,
  database: string,
  subtrees: FilesystemTreeSpec[]
): Promise<ItemMetadata[]> => {
  const { root, envName, apiTimeoutMs, options } = ctx;
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
  return destinationMetadata;
};

/** Publish processed item ids to every configured target. */
const publishProcessed = async (
  ctx: PushDatabaseContext,
  processedIds: string[],
  summaryEntry: PushSummaryEntry
): Promise<void> => {
  const { root, envName, apiTimeoutMs, options, logger, summary } = ctx;
  if (!(options.publish && processedIds.length > 0 && !options.whatIf)) {
    return;
  }
  const targets = options.targets && options.targets.length > 0 ? options.targets : [undefined];
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
};

/** Push one database's subtrees: diff, enrich, apply, optionally publish. */
const pushOneDatabase = async (
  ctx: PushDatabaseContext,
  database: string,
  subtrees: FilesystemTreeSpec[]
): Promise<void> => {
  const { root, envName, options, logger, summary } = ctx;
  options.emit?.({ kind: "database-start", database, subtreeCount: subtrees.length });
  const spinner = await startSpinner(`Pushing ${database} items`);
  try {
    const { items: sourceItems, metadata: sourceMetadata } = await loadFilesystemItems(subtrees);
    const destinationMetadata = await fetchDestinationMetadata(ctx, database, subtrees);

    const commands = buildCommandsForDatabase(subtrees, sourceMetadata, destinationMetadata, true);
    const changes = commands.length;
    summary.totalChanges += changes;
    options.emit?.({ kind: "database-changes-detected", database, changes });
    const summaryEntry: PushSummaryEntry = {
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
      return;
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

    const processedIds = await applySitecoreCommands({
      root,
      environmentName: envName,
      database,
      commands,
      logger,
      whatIf: options.whatIf,
    });

    await publishProcessed(ctx, processedIds, summaryEntry);
    options.emit?.({
      kind: "database-applied",
      database,
      changes,
      whatIf: Boolean(options.whatIf),
    });
    spinner?.succeed();
    summary.databases.push(summaryEntry);
  } catch (error) {
    spinner?.fail();
    throw error;
  }
};

export const runPush = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const { root, modules } = await loadConfigAndModules(options);
  const envName = options.environmentName ?? root.defaultEnvironment;
  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const summary: PushSummary = {
    command: "serialization.push",
    environment: envName,
    whatIf: Boolean(options.whatIf),
    totalChanges: 0,
    publishedCount: 0,
    databases: [],
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

  const ctx: PushDatabaseContext = { root, envName, apiTimeoutMs, options, logger, summary };
  const subtreesByDb = groupSubtreesByDatabase(modules);
  for (const [database, subtrees] of subtreesByDb) {
    if (options.signal?.aborted) {
      options.emit?.({ kind: "database-skipped", database, reason: "cancelled-by-client" });
      break;
    }
    await pushOneDatabase(ctx, database, subtrees);
  }

  for (const module of modules) {
    await syncRolesPush(root, module, envName, logger);
    await syncUsersPush(root, module, envName, logger);
  }

  if (logger.isJson()) {
    logger.json(
      buildScaiEnvelope({
        command: "serialization.push",
        environment: envName,
        data: summary,
      }) as unknown as Record<string, unknown>
    );
  }
};
