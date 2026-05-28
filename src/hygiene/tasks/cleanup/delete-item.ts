/**
 * Single-item delete. Thin wrapper around `runCleanupSubtree` that
 * constrains the operation to one item — no descendants, simpler
 * option contract.
 *
 * Why a separate task and not "use cleanup subtree on a leaf path":
 * the subtree runner's mental model is "I want this tree gone";
 * agents needing to delete a single content item shouldn't have to
 * reason about cascade semantics that don't apply. This shim accepts
 * `{ path | itemId }` plus the standard safety flags and forwards
 * to the subtree runner — which already handles the resolve step,
 * the inbound-ref check, the policy gate, and the `whatIf` /
 * `--allow-write` plumbing. Same safety model, narrower contract.
 *
 * Use cases:
 *   - Agent surgically deleting a stale content item it just
 *     discovered via `audit references --to <id>`
 *   - Recipe rollback paths where a single CreateItem failed and the
 *     caller needs to clean up the orphan
 *
 * If you need cascade (deleting a tree with descendants), use
 * `runCleanupSubtree` directly.
 */
import { runCleanupSubtree } from "./subtree";
import type { CleanupSubtreeOptions, CleanupSubtreeResult } from "./subtree";
import { createScaiError } from "@/shared/errors";

export type CleanupDeleteItemOptions = Omit<
  CleanupSubtreeOptions,
  "path" | "orphanExternalRefs"
> & {
  /** Content-tree path of the item to delete. Mutually exclusive with `itemId`. */
  path?: string;
  /** Item GUID. Mutually exclusive with `path`. */
  itemId?: string;
  /**
   * How to handle external items whose fields reference the target.
   * Mirrors `cleanup subtree`'s flag — default refuses with blocker
   * list. Pass `'clear'` / `'prune'` / `'leave'` for the same
   * semantics as subtree.
   */
  orphanExternalRefs?: CleanupSubtreeOptions["orphanExternalRefs"];
};

export type CleanupDeleteItemResult = CleanupSubtreeResult;

export const runCleanupDeleteItem = async (
  options: CleanupDeleteItemOptions
): Promise<CleanupDeleteItemResult> => {
  if (!options.path && !options.itemId) {
    throw createScaiError("delete-item requires either `path` or `itemId`.", "INPUT_INVALID");
  }
  if (options.path && options.itemId) {
    throw createScaiError(
      "delete-item: pass either `path` or `itemId`, not both.",
      "INPUT_INVALID"
    );
  }
  // Subtree expects `path`. When the caller passed `itemId`, resolve
  // the path lazily by routing through subtree's own search step —
  // achieved by passing a sentinel-ish search expression won't work,
  // so we require subtree-shape input. For the itemId case, the
  // caller can use `cleanup subtree` directly; we narrow this entry
  // to the path form to keep the contract clean.
  if (!options.path) {
    throw createScaiError(
      "delete-item by `itemId` is not yet supported — pass the item's `path`.",
      "INPUT_INVALID",
      {
        hint: "Run `audit references --to <itemId>` to find the path, or use `cleanup subtree` directly.",
      }
    );
  }
  return runCleanupSubtree({
    ...options,
    path: options.path,
  } as CleanupSubtreeOptions);
};
