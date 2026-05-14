import type { EnvironmentConfiguration } from "@/config/types";
import { runAuthoringGraphQL } from "@/recipe/api/graphql";
import { createScaiError } from "@/shared/errors";

/**
 * Resolve Sitecore content-tree paths to item IDs via the Authoring
 * GraphQL `item(where: { path: ... })` query.
 *
 * The Publishing API only accepts item IDs in `ItemModel.id`; this
 * helper bridges path-based addressing so `scai publish item --paths`
 * works. Batches multiple paths into a single GraphQL request using
 * field aliases (`i0: item(...) { itemId }`, `i1: ...`) — same
 * pattern the recipe runtime uses internally (see
 * `src/recipe/api/authoring-client.ts:getItemsByPaths`), but without
 * the recipe workspace coupling.
 *
 * Errors with `INPUT_INVALID` listing every path that didn't resolve,
 * so an operator publishing a batch sees all bad inputs at once
 * rather than playing whack-a-mole.
 */

const BATCH_SIZE = 25;

const buildBatchQuery = (count: number): string => {
  const aliases: string[] = [];
  for (let i = 0; i < count; i += 1) {
    aliases.push(`  i${i}: item(where: { path: $p${i} }) { itemId path }`);
  }
  const vars = Array.from({ length: count }, (_, i) => `$p${i}: String!`).join(", ");
  return `query Batch(${vars}) {\n${aliases.join("\n")}\n}`;
};

interface ResolvedItem {
  path: string;
  itemId: string;
}

interface ResolveItemPathsResult {
  resolved: ResolvedItem[];
}

export const resolveItemPathsToIds = async (
  environment: EnvironmentConfiguration,
  paths: string[]
): Promise<ResolveItemPathsResult> => {
  if (paths.length === 0) {
    return { resolved: [] };
  }
  // De-duplicate while preserving order so the returned map is
  // predictable for the caller.
  const seen = new Set<string>();
  const uniquePaths: string[] = [];
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      uniquePaths.push(p);
    }
  }

  const resolved = new Map<string, string>();
  const missing: string[] = [];

  for (let offset = 0; offset < uniquePaths.length; offset += BATCH_SIZE) {
    const batch = uniquePaths.slice(offset, offset + BATCH_SIZE);
    const query = buildBatchQuery(batch.length);
    const variables: Record<string, string> = {};
    for (let i = 0; i < batch.length; i += 1) {
      variables[`p${i}`] = batch[i];
    }
    const data = await runAuthoringGraphQL<Record<string, { itemId?: string } | null>>(
      environment,
      query,
      variables
    );
    for (let i = 0; i < batch.length; i += 1) {
      const node = data[`i${i}`];
      if (node?.itemId) {
        resolved.set(batch[i], node.itemId);
      } else {
        missing.push(batch[i]);
      }
    }
  }

  if (missing.length > 0) {
    throw createScaiError(
      `Could not resolve ${missing.length} item path(s) to IDs.`,
      "INPUT_INVALID",
      {
        hint: `Paths not found in the env's content tree: ${missing.join(", ")}. Verify the paths exist and that the authenticated client has read access.`,
      }
    );
  }

  // Re-emit in caller-input order so multi-item publishing audits in a
  // predictable order.
  return {
    resolved: paths.map((path) => ({ path, itemId: resolved.get(path)! })),
  };
};
