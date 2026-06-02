/**
 * Generic per-cell three-way-merge helpers, shared across every kind
 * whose baseline payload is a flat `Record<path, hash>` map.
 *
 * Two halves:
 *
 *  1. {@link classifyCellHashMaps} — given desired / current / baseline
 *     hash maps, produce a per-path {@link FieldClassification}. Paths
 *     present in only one side classify against the absent-value hash
 *     (`hashJsonValue(undefined)`) on the other.
 *
 *  2. {@link resolveCellByPolicy} — given a classification + a push
 *     policy, decide whether the desired or current value wins for a
 *     single cell. Returns `"policyError"` when the policy is `"error"`
 *     and the classification is one that can't be silently merged
 *     (`cms-edit` / `conflict`).
 *
 * Each domain's merge driver still owns its recipe-shape traversal —
 * brands have sections × fields, campaigns have project + deliverables
 * × tasks — but the dispatch logic ("which side wins this path?") is
 * identical and lives here.
 */

import { classifyHashes, hashJsonValue, type FieldClassification } from "./baseline";

/**
 * Three-way classify every path that appears in any of the three hash
 * maps. Cells present in only one side classify against the
 * absent-value hash on the other.
 */
export const classifyCellHashMaps = (
  desiredHashes: Record<string, string>,
  currentHashes: Record<string, string>,
  baselineHashes: Record<string, string> | undefined
): Record<string, FieldClassification> => {
  const allPaths = new Set([
    ...Object.keys(desiredHashes),
    ...Object.keys(currentHashes),
    ...(baselineHashes ? Object.keys(baselineHashes) : []),
  ]);
  const classifications: Record<string, FieldClassification> = {};
  const absentHash = hashJsonValue(undefined);
  for (const path of allPaths) {
    classifications[path] = classifyHashes(
      desiredHashes[path] ?? absentHash,
      currentHashes[path] ?? absentHash,
      baselineHashes?.[path]
    );
  }
  return classifications;
};

/**
 * Resolve which side wins for a single cell under the push conflict
 * policy.
 *
 *  - `noop` / `recipe-change` / `first-push` → `"desired"` regardless
 *    of policy.
 *  - `cms-edit` / `conflict` → `"current"` under `cms-wins`,
 *    `"policyError"` under `error`, `"desired"` under `recipe-wins`.
 */
export const resolveCellByPolicy = (
  classification: FieldClassification,
  policy: "error" | "recipe-wins" | "cms-wins"
): "desired" | "current" | "policyError" => {
  if (classification === "cms-edit" || classification === "conflict") {
    if (policy === "cms-wins") return "current";
    if (policy === "error") return "policyError";
    return "desired";
  }
  return "desired";
};
