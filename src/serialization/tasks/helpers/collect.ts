import { readRootConfiguration } from "@/config";
import { FilesystemTreeSpec } from "../../tree-spec";
import { createFieldFilterSet } from "../../field-filter";
import { ItemData, ItemMetadata } from "../../types";
import { fetchItemData, fetchItemMetadata } from "../../sitecore-api";
import { resolveApiTimeoutMs } from "../shared";
import { createScaiError } from "@/shared/errors";
import { mapWithConcurrency } from "@/shared/concurrency";

export const collectItemData = async (
  environmentName: string,
  root: ReturnType<typeof readRootConfiguration>,
  subtrees: FilesystemTreeSpec[],
  useDebugSignatures: boolean
): Promise<{ items: ItemData[]; metadata: ItemMetadata[] }> => {
  const env = root.environments[environmentName];
  if (!env) {
    throw createScaiError(`Environment ${environmentName} was not defined.`, "ENV_NOT_FOUND");
  }
  const apiTimeoutMs = resolveApiTimeoutMs(root);
  // Hoist filter creation: `excludedFields` is invariant across this call,
  // so the same filter instance is safe to share across every fetch.
  const filter = createFieldFilterSet(root.serialization.excludedFields, []);

  // Subtree metadata fetches are independent — run concurrently with a
  // bounded fan-out. Result ordering is preserved by mapWithConcurrency,
  // matching the previous sequential behaviour.
  const perSubtreeMetadata = await mapWithConcurrency(subtrees, async (subtree) => {
    const subtreeMetadata = await fetchItemMetadata(
      env,
      subtree.database,
      subtree.path.toPathString(),
      subtree.scope,
      filter,
      useDebugSignatures,
      { timeoutMs: apiTimeoutMs }
    );
    return subtreeMetadata.filter((item) => subtree.includesPath(item.path));
  });
  const metadata: ItemMetadata[] = perSubtreeMetadata.flat();

  // Item-body fetches were sequential — the biggest perf hit in the
  // diff/push/pull path. For N items at ~100 ms each, sequential was N *
  // 100 ms; parallel with concurrency 8 is roughly N/8 * 100 ms. Order
  // preserved so downstream callers see the same shape they always did.
  const perItemData = await mapWithConcurrency(metadata, async (meta) =>
    fetchItemData(env, meta.database ?? "master", meta.id, "SingleItem", filter, {
      timeoutMs: apiTimeoutMs,
    })
  );
  const items: ItemData[] = perItemData.flat();

  return { items, metadata };
};
