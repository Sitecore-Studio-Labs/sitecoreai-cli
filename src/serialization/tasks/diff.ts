import path from "node:path";
import { ItemPath } from "../item-path";
import { FilesystemTreeSpec, AllowedPushOperations, TreeScope } from "../tree-spec";
import { createFieldFilterSet, type FieldFilterSet } from "../field-filter";
import { ItemMetadata } from "../types";
import { fetchItemMetadata } from "../api/items";
import { enrichCreateCommands, enrichUpdateCommands, type ItemCommand } from "../commands";
import {
  groupSubtreesByDatabase,
  loadConfigAndModules,
  resolveApiTimeoutMs,
  toLogger,
  ensureAllowWrite,
} from "./shared";
import type { DiffOptions } from "./types";
import { applySitecoreCommands } from "./helpers/sitecore";
import { buildCommandsForDatabase } from "./helpers/commands";
import { buildItemDataMap } from "./helpers/items";
import { collectItemData } from "./helpers/collect";
import { inputError, confirmDestructive } from "@/shared/cli-tasks";
import { mapWithConcurrency } from "@/shared/concurrency";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";

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
  await applySitecoreCommands({
    root,
    environmentName: destName,
    database,
    commands,
    logger,
    whatIf: Boolean(options.whatIf),
  });
};

interface DiffSummary {
  command: string;
  mode: DiffMode;
  source: string;
  destination: string;
  path: string | null;
  push: boolean;
  whatIf: boolean;
  totalDifferences: number;
  databases: DatabaseDiffSummary[];
}

/** Warn (non-JSON) when an explicit same-environment diff was requested. */
const warnSameEnvironment = (
  options: DiffOptions,
  mode: DiffMode,
  sourceName: string,
  logger: ReturnType<typeof toLogger>
): void => {
  if (mode !== "local-vs-instance" || logger.isJson()) {
    return;
  }
  if (options.source && options.destination) {
    logger.info(
      `Source and target are the same environment ('${sourceName}'). Diff will report zero differences. ` +
        "Pass distinct --source-env / --target-env to diff two environments.",
      "yellow"
    );
  }
};

/** Apply the push write-gate (mirror of push.ts) before any destination mutation. */
const applyPushWriteGate = (
  options: DiffOptions,
  root: RootConfiguration,
  destName: string
): void => {
  if (!options.push) {
    return;
  }
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
};

/**
 * Run diff for a single database, folding results into the summary. The
 * caller passes `beforePush` to interleave its own emit between the diff
 * and the optional push (module mode needs `database-changes-detected`
 * emitted there, exactly as the original sequential code did).
 */
const runDatabaseDiff = async (
  args: DiffDatabaseArgs,
  summary: DiffSummary,
  logger: ReturnType<typeof toLogger>,
  beforePush?: (dbSummary: DatabaseDiffSummary) => void
): Promise<void> => {
  const { commands, summary: dbSummary } = await diffDatabase(args);
  summary.databases.push(dbSummary);
  summary.totalDifferences += dbSummary.differences;
  beforePush?.(dbSummary);
  if (!logger.isJson()) {
    logger.info(`Discovered ${dbSummary.differences} differences for ${args.database}.`, "green");
  }
  if (args.options.push) {
    await pushDatabase(args, commands, logger);
  }
};

/** Path mode: diff a single subtree explicitly requested via `-p`. */
const runPathModeDiff = async (params: {
  options: DiffOptions;
  root: RootConfiguration;
  sourceName: string;
  destName: string;
  filter: FieldFilterSet;
  apiTimeoutMs: number | undefined;
  summary: DiffSummary;
  logger: ReturnType<typeof toLogger>;
}): Promise<void> => {
  const { options, root, sourceName, destName, filter, apiTimeoutMs, summary, logger } = params;
  const sourceDatabase = options.sourceDatabase ?? "master";
  const destinationDatabase = options.destinationDatabase ?? sourceDatabase;
  const subtree = new FilesystemTreeSpec();
  subtree.name = "diff";
  subtree.database = destinationDatabase;
  subtree.path = ItemPath.fromPathString(options.path!);
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
  await runDatabaseDiff(args, summary, logger);
};

/** Module mode: walk subtrees grouped by database, sequentially. */
const runModuleModeDiff = async (params: {
  options: DiffOptions;
  root: RootConfiguration;
  modules: Parameters<typeof groupSubtreesByDatabase>[0];
  sourceName: string;
  destName: string;
  filter: FieldFilterSet;
  apiTimeoutMs: number | undefined;
  summary: DiffSummary;
  logger: ReturnType<typeof toLogger>;
}): Promise<void> => {
  const { options, root, modules, sourceName, destName, filter, apiTimeoutMs, summary, logger } =
    params;
  // Databases stay sequential — typically only master+core, and
  // serializing them keeps spinner output / partial-failure semantics
  // predictable.
  const subtreesByDb = groupSubtreesByDatabase(modules);
  for (const [database, subtrees] of subtreesByDb) {
    if (options.signal?.aborted) {
      options.emit?.({ kind: "database-skipped", database, reason: "cancelled-by-client" });
      break;
    }
    options.emit?.({ kind: "database-start", database, subtreeCount: subtrees.length });
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
    let differences = 0;
    await runDatabaseDiff(args, summary, logger, (dbSummary) => {
      differences = dbSummary.differences;
      options.emit?.({
        kind: "database-changes-detected",
        database,
        changes: dbSummary.differences,
      });
    });
    if (options.push) {
      options.emit?.({
        kind: "database-applied",
        database,
        changes: differences,
        whatIf: Boolean(options.whatIf),
      });
    }
  }
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
  warnSameEnvironment(options, mode, sourceName, logger);
  applyPushWriteGate(options, root, destName);

  // Hoist filter: excludedFields is invariant across all subtrees and dbs.
  const filter = createFieldFilterSet(root.serialization.excludedFields, []);

  const summary: DiffSummary = {
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

  if (options.path) {
    await runPathModeDiff({
      options,
      root,
      sourceName,
      destName,
      filter,
      apiTimeoutMs,
      summary,
      logger,
    });
  } else {
    await runModuleModeDiff({
      options,
      root,
      modules,
      sourceName,
      destName,
      filter,
      apiTimeoutMs,
      summary,
      logger,
    });
  }

  if (logger.isJson()) {
    logger.json(summary);
  }
};
