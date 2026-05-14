import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  ensureAllowWriteForCleanup,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";
import type { HygieneApiClient } from "../api/client";

export interface CleanupEmptyFoldersOptions extends HygieneCommonOptions {
  /** Required. Root path to clean up under. */
  root: string;
  /** Cap on deletions. Default 500. */
  maxDeletions?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
  /**
   * Permit operating against `/sitecore/system` and templates roots.
   * Off by default. Required even with `--what-if` to avoid surprise.
   */
  force?: boolean;
}

export interface EmptyFolderAction {
  itemId: string;
  path: string;
  status: "deleted" | "what-if" | "failed";
  error?: string;
}

const PROTECTED_ROOTS = ["/sitecore/system", "/sitecore/templates", "/sitecore/layout"];

/**
 * Delete folder-like items that have no children, recursively
 * bottom-up under `--root`.
 *
 * Strategy:
 *   1. Walk the tree depth-first via `getChildren`.
 *   2. At each node, recurse; if every child reports as "empty after
 *      cleanup" (i.e. itself got deleted), and the node itself has
 *      no remaining children, delete the node.
 *   3. Continue bubbling up — parent may become empty after its
 *      children are deleted.
 *
 * Safety rails:
 *   - `--root` required; no tenant-wide form.
 *   - `/sitecore/system`, `/sitecore/templates`, `/sitecore/layout`
 *     refused without `--force`.
 *   - `--allow-write` (or env `allowWrite`) required outside
 *     `--what-if`.
 *   - `--max-deletions` caps total folder removals.
 *   - Items that have content (non-folder template, fields with
 *     values) are NOT touched — we ONLY delete items with zero
 *     children, regardless of their template. If a "Page" item has
 *     no children, the operator should clean it via `cleanup
 *     duplicates` or similar, not here.
 */
export const runCleanupEmptyFolders = async (
  options: CleanupEmptyFoldersOptions
): Promise<EmptyFolderAction[]> => {
  const logger = toLogger(options);
  if (!options.root) {
    throw createScaiError("--root is required.", "INPUT_INVALID");
  }
  if (!options.force && PROTECTED_ROOTS.some((p) => options.root.startsWith(p))) {
    throw createScaiError(
      `Refusing to operate under protected root '${options.root}' without --force.`,
      "INPUT_INVALID"
    );
  }

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no folders will be deleted.", "yellow");
  }

  const maxDeletions = options.maxDeletions ?? 500;
  const actions: EmptyFolderAction[] = [];

  const walk = async (path: string): Promise<boolean> => {
    if (actions.length >= maxDeletions) return false;
    let children: Awaited<ReturnType<HygieneApiClient["getChildren"]>>;
    try {
      children = await client.getChildren({ path });
    } catch {
      return false;
    }
    if (children.length === 0) return true;
    const childResults = await Promise.all(
      children.map(async (child) => {
        const childEmpty = await walk(child.path);
        if (!childEmpty) return false;
        if (actions.length >= maxDeletions) return false;
        const action: EmptyFolderAction = {
          itemId: child.itemId,
          path: child.path,
          status: options.whatIf ? "what-if" : "deleted",
        };
        if (!options.whatIf) {
          try {
            await client.deleteItem({ itemId: child.itemId, permanently: true });
          } catch (error) {
            action.status = "failed";
            action.error = error instanceof Error ? error.message : String(error);
          }
        }
        actions.push(action);
        return action.status !== "failed";
      })
    );
    return childResults.every((r) => r === true);
  };

  await walk(options.root);

  const deleted = actions.filter((a) => a.status === "deleted").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const summary = options.whatIf
    ? `Plan: would delete ${actions.length} empty folder${actions.length === 1 ? "" : "s"}.`
    : `Deleted ${deleted} empty folder${deleted === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}.`;

  printReport({
    logger,
    command: "cleanup.empty-folders",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "what-if" ? "[would delete] " : a.status === "failed" ? "[failed] " : ""}${a.path}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      root: options.root,
      whatIf: Boolean(options.whatIf),
      maxDeletions,
      deletedCount: deleted,
      failedCount: failed,
    },
    options,
  });

  return actions;
};
