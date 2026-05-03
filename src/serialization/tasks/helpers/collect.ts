import { readRootConfiguration } from "@/config";
import { FilesystemTreeSpec } from "../../tree-spec";
import { createFieldFilterSet } from "../../field-filter";
import { ItemData, ItemMetadata } from "../../types";
import { fetchItemData, fetchItemMetadata } from "../../sitecore-api";
import { resolveApiTimeoutMs } from "../shared";
import { createCliError } from "@/shared/errors";

export const collectItemData = async (
  environmentName: string,
  root: ReturnType<typeof readRootConfiguration>,
  subtrees: FilesystemTreeSpec[],
  useDebugSignatures: boolean
): Promise<{ items: ItemData[]; metadata: ItemMetadata[] }> => {
  const env = root.environments[environmentName];
  if (!env) {
    throw createCliError(`Environment ${environmentName} was not defined.`, "ENV_NOT_FOUND");
  }
  const apiTimeoutMs = resolveApiTimeoutMs(root);

  const items: ItemData[] = [];
  const metadata: ItemMetadata[] = [];
  for (const subtree of subtrees) {
    const filter = createFieldFilterSet(root.serialization.excludedFields, []);
    const subtreeMetadata = await fetchItemMetadata(
      env,
      subtree.database,
      subtree.path.toPathString(),
      subtree.scope,
      filter,
      useDebugSignatures,
      { timeoutMs: apiTimeoutMs }
    );

    const filtered = subtreeMetadata.filter((item) => subtree.includesPath(item.path));
    metadata.push(...filtered);
  }

  for (const meta of metadata) {
    const filter = createFieldFilterSet(root.serialization.excludedFields, []);
    const itemData = await fetchItemData(
      env,
      meta.database ?? "master",
      meta.id,
      "SingleItem",
      filter,
      { timeoutMs: apiTimeoutMs }
    );
    items.push(...itemData);
  }

  return { items, metadata };
};
