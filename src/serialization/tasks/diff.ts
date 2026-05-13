import path from "node:path";
import { ItemPath } from "../item-path";
import { FilesystemTreeSpec, AllowedPushOperations, TreeScope } from "../tree-spec";
import { createFieldFilterSet, type FieldFilterSet } from "../field-filter";
import { ItemMetadata } from "../types";
import { fetchItemMetadata } from "../sitecore-api";
import { enrichCreateCommands, enrichUpdateCommands, type ItemCommand } from "../commands";
import {
  groupSubtreesByDatabase,
  loadConfigAndModules,
  resolveApiTimeoutMs,
  toLogger,
  ensureAllowWrite,
} from "./shared";
import type { DiffOptions } from "./types";
import {
  applySitecoreCommands,
  buildCommandsForDatabase,
  buildItemDataMap,
  collectItemData,
} from "./helpers";
import { inputError, confirmDestructive } from "@/shared/cli-tasks";
import { mapWithConcurrency } from "@/shared/concurrency";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config";

/**
 * Two-environment-aware `ser diff`.
 *
 * Performance shape:
 *   - source + destination metadata fetches run concurrently
 *     (`Promise.all`) — was sequential.
 *   - within each environment, per-subtree metadata fetches run with
 *     bounded concurrency (`mapWithConcurrency`).
 *   - on --push, source-side and destination-side item-body fetches
 *     (`collectItemData`) run concurrently too.
 *   - the per-item `fetchItemData` fanout inside `collectItemData` is
 *     also bounded-concurrent (see `helpers/collect.ts`) — the biggest
 *     wall-clock win for trees with many items.
 *
 * Concurrency is bounded by SITECOREAI_HTTP_CONCURRENCY (default 8) so
 * we don't blow rate limits.
 */

type DiffMode = "local-vs-instance" | "instance-vs-instance";

interface DatabaseDiffSummary {
  database: string;
  differences: number;
  applied: boolean;
  whatIf: boolean;
  changes?: SerializedChanges;
}

interface ChangeEntry {
  id: string;
  path: string;
}

interface SerializedChanges {
  create: ChangeEntry[];
  update: ChangeEntry[];
  recycle: ChangeEntry[];
  move: ChangeEntry[];
  rename: ChangeEntry[];
}

const summarizeChanges = (commands: ItemCommand[]): SerializedChanges => {
  const out: SerializedChanges = {
    create: [],
    update: [],
    recycle: [],
    move: [],
    rename: [],
  };
  for (const cmd of commands) {
    const entry: ChangeEntry = {
      id: cmd.source.id,
      path: cmd.source.path.toPathString(),
    };
    out[cmd.type].push(entry);
  }
  return out;
};

/**
 * Fetch metadata for every subtree in a database, parallel-bounded.
 * Result preserves the (subtree, item) order of the input subtrees so
 * downstream `buildCommandsForDatabase` sees the same shape sequential
 * code produced.
 */
const fetchSubtreesMetadata = async (
  env: EnvironmentConfiguration,
  subtrees: FilesystemTreeSpec[],
  database: string,
  filter: FieldFilterSet,
  apiTimeoutMs: number | undefined
): Promise<ItemMetadata[]> => {
  const perSubtree = await mapWithConcurrency(subtrees, async (subtree) => {
    const data = await fetchItemMetadata(
      env,
      database,
      subtree.path.toPathString(),
      subtree.scope,
      filter,
      false,
      { timeoutMs: apiTimeoutMs }
    );
    return data.filter((item) => subtree.includesPath(item.path));
  });
  return perSubtree.flat();
};

interface DiffDatabaseArgs {
  root: RootConfiguration;
  sourceName: string;
  destName: string;
  database: string;
  subtrees: FilesystemTreeSpec[];
  filter: FieldFilterSet;
  apiTimeoutMs: number | undefined;
  options: DiffOptions;
}

/**
 * Run diff (and optional push) for one database against two
 * environments. Source and destination are fetched concurrently; on
 * --push, item-data collection for both sides also runs concurrently.
 */
const diffDatabase = async ({
  root,
  sourceName,
  destName,
  database,
  subtrees,
  filter,
  apiTimeoutMs,
  options,
}: DiffDatabaseArgs): Promise<{ commands: ItemCommand[]; summary: DatabaseDiffSummary }> => {
  const sourceEnv = root.environments[sourceName];
  const destEnv = root.environments[destName];

  const [sourceMetadata, destinationMetadata] = await Promise.all([
    fetchSubtreesMetadata(sourceEnv, subtrees, database, filter, apiTimeoutMs),
    fetchSubtreesMetadata(destEnv, subtrees, database, filter, apiTimeoutMs),
  ]);

  const commands = buildCommandsForDatabase(subtrees, sourceMetadata, destinationMetadata, true);
  const differences = commands.length;
  const whatIf = Boolean(options.push && options.whatIf);
  const applied = Boolean(options.push) && !whatIf;

  const summary: DatabaseDiffSummary = {
    database,
    differences,
    applied,
    whatIf,
  };
  if (options.verbose) {
    summary.changes = summarizeChanges(commands);
  }
  return { commands, summary };
};

/**
 * Apply a planned diff to the destination environment for one
 * database. Source + destination item-body fetches run concurrently.
 */
const pushDatabase = async (
  args: DiffDatabaseArgs,
  commands: ItemCommand[],
  logger: ReturnType<typeof toLogger>
): Promise<void> => {
  const { root, sourceName, destName, database, subtrees, options } = args;
  // Guard: an empty source against a populated target would recycle
  // every item in the database. Require --force to confirm intent.
  if (commands.some((cmd) => cmd.type === "recycle")) {
    const recycles = commands.filter((cmd) => cmd.type === "recycle").length;
    const sourceMeta = await fetchSubtreesMetadata(
      root.environments[sourceName],
      subtrees,
      database,
      args.filter,
      args.apiTimeoutMs
    );
    // Re-check on the cached side: if source has zero items but destination has many,
    // that's the catastrophic-stomp scenario the dotnet CLI quietly executes.
    if (sourceMeta.length === 0 && recycles > 0) {
      const confirmed = await confirmDestructive(
        `Source environment '${sourceName}' is empty for database '${database}'. ` +
          `Push would recycle ${recycles} items in '${destName}'. Proceed?`,
        options.force
      );
      if (!confirmed) {
        logger.info("Push cancelled.", "yellow");
        return;
      }
    }
  }

  const [sourceData, destData] = await Promise.all([
    collectItemData(sourceName, root, subtrees, false),
    collectItemData(destName, root, subtrees, false),
  ]);
  const sourceDataMap = buildItemDataMap(sourceData.items);
  const destDataMap = buildItemDataMap(destData.items);
  enrichCreateCommands(commands, sourceDataMap);
  enrichUpdateCommands(commands, sourceDataMap, destDataMap, true);
  await applySitecoreCommands(root, destName, database, commands, logger, Boolean(options.whatIf));
};

export const runDiff = async (options: DiffOptions): Promise<void> => {
  const logger = toLogger(options);
  const { root, modules } = await loadConfigAndModules(options);
  const sourceName = options.source ?? root.defaultEnvironment;
  const destName = options.destination ?? root.defaultEnvironment;
  const apiTimeoutMs = resolveApiTimeoutMs(root);

  if (!root.environments[sourceName]) {
    throw inputError(`Source environment '${sourceName}' is not defined in sitecoreai.cli.json.`);
  }
  if (!root.environments[destName]) {
    throw inputError(`Target environment '${destName}' is not defined in sitecoreai.cli.json.`);
  }

  const mode: DiffMode = sourceName === destName ? "local-vs-instance" : "instance-vs-instance";
  // Same-env diff is a legacy/legitimate no-op (both default to
  // root.defaultEnvironment). Surface a friendly note in non-JSON mode
  // so users aren't confused by zero differences.
  if (mode === "local-vs-instance" && !logger.isJson()) {
    if (options.source && options.destination) {
      logger.info(
        `Source and target are the same environment ('${sourceName}'). Diff will report zero differences. ` +
          "Pass distinct --source-env / --target-env to diff two environments.",
        "yellow"
      );
    }
  }

  if (options.push) {
    // Mirror push.ts: --allow-write flag mutates the in-memory env so
    // ensureAllowWrite passes; --what-if skips the write gate entirely.
    if (options.allowWrite) {
      const destEnvCfg = root.environments[destName];
      if (destEnvCfg) {
        destEnvCfg.allowWrite = true;
      }
    }
    if (!options.whatIf) {
      ensureAllowWrite(root, destName);
    }
  }

  // Hoist filter: excludedFields is invariant across all subtrees and dbs.
  const filter = createFieldFilterSet(root.serialization.excludedFields, []);

  const summary: {
    command: string;
    mode: DiffMode;
    source: string;
    destination: string;
    path: string | null;
    push: boolean;
    whatIf: boolean;
    totalDifferences: number;
    databases: DatabaseDiffSummary[];
  } = {
    command: "serialization.diff",
    mode,
    source: sourceName,
    destination: destName,
    path: options.path ?? null,
    push: Boolean(options.push),
    whatIf: Boolean(options.push && options.whatIf),
    totalDifferences: 0,
    databases: [],
  };

  // Path mode: a single subtree explicitly requested via -p.
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

    const args: DiffDatabaseArgs = {
      root,
      sourceName,
      destName,
      database: destinationDatabase,
      subtrees: [subtree],
      filter,
      apiTimeoutMs,
      options,
    };
    const { commands, summary: dbSummary } = await diffDatabase(args);
    summary.databases.push(dbSummary);
    summary.totalDifferences += dbSummary.differences;
    if (!logger.isJson()) {
      logger.info(
        `Discovered ${dbSummary.differences} differences for ${destinationDatabase}.`,
        "green"
      );
    }

    if (options.push) {
      await pushDatabase(args, commands, logger);
    }

    if (logger.isJson()) {
      logger.json(summary);
    }
    return;
  }

  // Module mode: walk subtrees grouped by database. Databases stay
  // sequential — typically only master+core, and serializing them
  // keeps spinner output / partial-failure semantics predictable.
  const subtreesByDb = groupSubtreesByDatabase(modules);
  for (const [database, subtrees] of subtreesByDb) {
    const args: DiffDatabaseArgs = {
      root,
      sourceName,
      destName,
      database,
      subtrees,
      filter,
      apiTimeoutMs,
      options,
    };
    const { commands, summary: dbSummary } = await diffDatabase(args);
    summary.databases.push(dbSummary);
    summary.totalDifferences += dbSummary.differences;
    if (!logger.isJson()) {
      logger.info(`Discovered ${dbSummary.differences} differences for ${database}.`, "green");
    }

    if (options.push) {
      await pushDatabase(args, commands, logger);
    }
  }

  if (logger.isJson()) {
    logger.json(summary);
  }
};
