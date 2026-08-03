import { createScaiError } from "@/shared/errors";
import type { ScaiClient } from "../connect";

/**
 * Subtree utilities — composable helpers for relocating parts of the
 * Sitecore content tree.
 *
 * `move` wraps the Authoring `moveItem` mutation, which preserves the
 * item's `itemId`, name, and every inbound reference. The alternative
 * (delete + recreate) assigns a fresh itemId and breaks every link
 * pointing at the old one — which is why relocating a subtree used to be
 * a sharp edge rather than a routine edit.
 *
 * `scai content move` is the CLI surface over the same mutation. These
 * helpers exist for the cases the CLI doesn't fit: moving many items in
 * one pass, deciding the destination from a query, or composing a move
 * with other surgery in a single script.
 *
 * Safe-by-default, matching `multilist`: every mutator takes
 * `allowWrite: boolean`. When false (the default), the helper resolves
 * both ends and reports what *would* happen without making the wire
 * call. Callers wire their own consent — script authors decide when to
 * flip the flag.
 */

export interface MoveArgs {
  /** Source item — pass exactly one of `itemId` / `path`. */
  itemId?: string;
  path?: string;
  /** Destination parent — pass exactly one of `toItemId` / `toPath`. */
  toItemId?: string;
  toPath?: string;
  /** When false (default), no mutation is made — resolves and reports only. */
  allowWrite?: boolean;
}

export interface MoveResult {
  /** Resolved itemId of the source. Unchanged by the move. */
  itemId: string;
  /** Source path as it was BEFORE the move. */
  from?: string;
  /** Resolved destination parent. */
  toParent: { itemId: string; path?: string };
  /**
   * False when the item is already a child of the destination parent —
   * the move would be a no-op and no wire call is made even with
   * `allowWrite: true`.
   */
  changed: boolean;
  /** True only when the mutation actually reached the Authoring API. */
  applied: boolean;
}

const requireExactlyOne = (
  a: string | undefined,
  b: string | undefined,
  label: string,
  fields: [string, string]
): void => {
  if (a && b) {
    throw createScaiError(
      `move: pass exactly one of ${fields[0]} / ${fields[1]} for the ${label}.`,
      "INPUT_INVALID"
    );
  }
  if (!a && !b) {
    throw createScaiError(
      `move: ${label} requires one of ${fields[0]} / ${fields[1]}.`,
      "INPUT_INVALID"
    );
  }
};

/**
 * Relocate a single item to a new parent, preserving its `itemId` and
 * every inbound reference.
 *
 * Both ends are resolved before anything is written, so a mistyped path
 * fails with a typed `INPUT_INVALID` naming the side that didn't
 * resolve, rather than a generic GraphQL error from the server.
 *
 * Returns `changed: false` when the item already sits under the
 * destination parent. `applied: true` only when the mutation reached the
 * Authoring API — that is, `changed` was true AND `allowWrite` was set.
 */
export const move = async (client: ScaiClient, args: MoveArgs): Promise<MoveResult> => {
  requireExactlyOne(args.itemId, args.path, "source", ["itemId", "path"]);
  requireExactlyOne(args.toItemId, args.toPath, "destination parent", ["toItemId", "toPath"]);

  const sourceSelector = args.itemId ? { itemId: args.itemId } : { path: args.path! };
  const targetSelector = args.toItemId ? { itemId: args.toItemId } : { path: args.toPath! };

  const [source, target] = await Promise.all([
    client.authoring.getItem(sourceSelector),
    client.authoring.getItem(targetSelector),
  ]);
  if (!source) {
    throw createScaiError(`Source item '${args.itemId ?? args.path}' not found.`, "INPUT_INVALID");
  }
  if (!target) {
    throw createScaiError(
      `Target parent '${args.toItemId ?? args.toPath}' not found.`,
      "INPUT_INVALID"
    );
  }

  const result: MoveResult = {
    itemId: source.itemId,
    from: source.path,
    toParent: { itemId: target.itemId, path: target.path },
    changed: true,
    applied: false,
  };

  // Already under the destination parent — nothing to do. Detected by
  // comparing the source's parent path to the target's path; a move to
  // the parent it already has is a no-op the API would accept silently,
  // and reporting `changed: false` is more useful than a phantom write.
  if (source.path && target.path) {
    const currentParent = source.path.slice(0, source.path.lastIndexOf("/"));
    if (currentParent.toLowerCase() === target.path.replace(/\/$/, "").toLowerCase()) {
      return { ...result, changed: false };
    }
  }

  if (!args.allowWrite) {
    return result;
  }

  await client.authoring.moveItem({ selector: sourceSelector, targetParent: targetSelector });
  return { ...result, applied: true };
};
