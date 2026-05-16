import { FilesystemPathProvider } from "../path-provider";
import { ItemPath } from "../item-path";
import { ItemMetadata } from "../types";
import { createFieldFilterSet } from "../field-filter";
import { fetchHistoryEntries, fetchHistoryTimestamp } from "../api/history";
import { fetchItemData } from "../api/items";
import { removeItemFromFilesystem, writeItemToFilesystem } from "../filesystem-store/items";
import {
  groupSubtreesByDatabase,
  loadConfigAndModules,
  resolveApiTimeoutMs,
  toLogger,
} from "./shared";
import type { WatchOptions } from "./types";
import { runPull } from "./pull";

export const runWatch = async (options: WatchOptions): Promise<void> => {
  const logger = toLogger(options);
  const { root, modules } = await loadConfigAndModules(options);
  const envName = options.environmentName ?? root.defaultEnvironment;
  const apiTimeoutMs = resolveApiTimeoutMs(root);

  if (!options.skipPull) {
    await runPull({ ...options, environmentName: envName });
  }

  const subtreesByDb = groupSubtreesByDatabase(modules);
  const pathProviders = new Map<string, FilesystemPathProvider>();
  for (const [database, subtrees] of subtreesByDb) {
    pathProviders.set(database, new FilesystemPathProvider(subtrees));
  }

  let timestamp = await fetchHistoryTimestamp(root.environments[envName], {
    timeoutMs: apiTimeoutMs,
  });
  logger.info(
    "Watcher is online! Changes made to serialized items will be automatically pulled.",
    "magenta"
  );

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const result = await fetchHistoryEntries(root.environments[envName], timestamp, {
      timeoutMs: apiTimeoutMs,
    });
    timestamp = result.timestamp;
    if (!result.entries.length) {
      continue;
    }

    for (const entry of result.entries) {
      const provider = pathProviders.get(entry.database);
      if (!provider) {
        continue;
      }
      const itemPath = ItemPath.fromPathString(entry.path);
      const subtrees = subtreesByDb.get(entry.database) ?? [];
      const matched = subtrees.some((subtree) => subtree.includesPath(itemPath));
      if (!matched) {
        continue;
      }

      if (entry.changeType === "Recycle") {
        const metadata: ItemMetadata = {
          id: entry.id,
          parentId: "",
          templateId: "",
          path: itemPath,
        };
        await removeItemFromFilesystem(provider, metadata);
        if (entry.oldPath) {
          const oldItemPath = ItemPath.fromPathString(entry.oldPath);
          await removeItemFromFilesystem(provider, {
            id: entry.id,
            parentId: "",
            templateId: "",
            path: oldItemPath,
          });
        }
        continue;
      }

      const filter = createFieldFilterSet(root.serialization.excludedFields, []);
      const data = await fetchItemData(
        root.environments[envName],
        entry.database,
        entry.id,
        "SingleItem",
        filter,
        { timeoutMs: apiTimeoutMs }
      );
      if (data.length > 0) {
        await writeItemToFilesystem(provider, data[0]);
      }
    }
  }
};
