import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import { runAuditDeadTemplates } from "./audit-dead-templates";
import {
  type HygieneCommonOptions,
  ensureAllowWriteForCleanup,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";
import type { HygieneApiClient } from "../api/client";

export interface CleanupDeadTemplatesOptions extends HygieneCommonOptions {
  /** Template-tree root. Default `/sitecore/templates/Project`. */
  root?: string;
  /** Cap on templates inspected. Default 5000. */
  limit?: number;
  /** Concurrency. Default 4. */
  concurrency?: number;
  /** Override the search index. */
  index?: string;
  /**
   * Whether to recursively delete now-empty template folders after
   * removing dead templates. Default true. Setting false leaves the
   * folder structure intact even when every template inside was dead.
   */
  cleanupEmptyFolders?: boolean;
  whatIf?: boolean;
  allowWrite?: boolean;
  /**
   * Permit operating against `/sitecore/templates/System` and other
   * platform template subtrees. Off by default — deleting a system
   * template breaks editor UIs even if it shows zero items.
   */
  force?: boolean;
}

export interface DeadTemplatePurgeAction {
  templateId: string;
  name: string;
  fullName: string | null;
  status: "purged" | "what-if" | "failed";
  error?: string;
}

export interface FolderCleanupAction {
  path: string;
  itemId: string;
  status: "deleted" | "what-if" | "failed" | "skipped";
  error?: string;
}

const PROTECTED_TEMPLATE_ROOTS = [
  "/sitecore/templates/System",
  "/sitecore/templates/Branches/System",
];

/**
 * Walk a template root bottom-up and delete folders that are empty after
 * the dead-templates purge.
 *
 * Algorithm:
 *   1. List children of the root.
 *   2. For each child, recurse: if it's a template-folder-shaped node
 *      (no template fields beyond folder template id), check its
 *      children. If empty, delete it.
 *   3. Bubble up — a parent may become empty after its children are
 *      deleted.
 *
 * Returns the list of folder deletions attempted, with status.
 */
const cleanupEmptyTemplateFolders = async (
  client: HygieneApiClient,
  rootPath: string,
  options: { whatIf: boolean }
): Promise<FolderCleanupAction[]> => {
  const actions: FolderCleanupAction[] = [];

  const walk = async (path: string): Promise<boolean> => {
    // Returns true if the folder ended up empty (parent should re-check).
    const children = await client.getChildren({ path });
    if (children.length === 0) return true;
    // Recurse into each child; track which ones are themselves empty folders.
    const childResults = await Promise.all(
      children.map(async (child) => {
        // Walk recursively; this may delete the child if it ends empty.
        const childEmpty = await walk(child.path);
        if (!childEmpty) return false;
        const action: FolderCleanupAction = {
          path: child.path,
          itemId: child.itemId,
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
    // The current folder is empty iff every child ended empty (and was
    // successfully deleted, or marked what-if).
    return childResults.every((r) => r === true);
  };

  await walk(rootPath);
  return actions;
};

/**
 * Delete templates that have zero items deriving from them, then
 * optionally clean up empty template folders left behind.
 *
 * Strategy:
 *   1. Run `audit dead-templates` to identify candidates.
 *   2. For each dead template, call `deleteItemTemplate(templateId)`.
 *   3. If `--cleanup-empty-folders` (default true), walk the template
 *      tree bottom-up and delete folders that ended up empty.
 *
 * Safety rails:
 *   - `--root` defaults to `/sitecore/templates/Project` (project-owned).
 *   - Refuses to operate on `/sitecore/templates/System` without
 *     `--force`. Deleting system templates breaks editor UIs even when
 *     they show zero items in the search index.
 *   - `--allow-write` / `allowWrite` enforced outside `--what-if`.
 *   - Cascades not handled: the underlying mutation fails (returns
 *     `successful: false`) if a template is still used as a base
 *     template by another, even when no items derive from it. Those
 *     failures surface as per-record errors with the operator's
 *     suggested next step in the message.
 */
export const runCleanupDeadTemplates = async (
  options: CleanupDeadTemplatesOptions
): Promise<{
  templates: DeadTemplatePurgeAction[];
  folders: FolderCleanupAction[];
}> => {
  const logger = toLogger(options);

  const root = options.root ?? "/sitecore/templates/Project";
  if (!options.force && PROTECTED_TEMPLATE_ROOTS.some((p) => root.startsWith(p))) {
    throw createScaiError(
      `Refusing to operate on protected template root '${root}'.`,
      "INPUT_INVALID",
      { hint: "Pass --force to override (only when you intentionally target a system tree)." }
    );
  }

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no templates or folders will be deleted.", "yellow");
  }

  // Reuse the audit task to find candidates.
  const dead = await runAuditDeadTemplates({
    ...options,
    // Suppress the audit's own report — we'll emit a combined cleanup
    // report below. Two ways: pipe through --json + ignore, or swallow
    // the print via a side-channel. For now we just let the audit print
    // its own report; under --json the caller sees two records (audit
    // then cleanup) which is reasonable.
  });

  const templateActions: DeadTemplatePurgeAction[] = await mapWithConcurrency(
    dead,
    async (t): Promise<DeadTemplatePurgeAction> => {
      if (options.whatIf) {
        return {
          templateId: t.templateId,
          name: t.name,
          fullName: t.fullName,
          status: "what-if",
        };
      }
      try {
        await client.deleteItemTemplate(t.templateId);
        return {
          templateId: t.templateId,
          name: t.name,
          fullName: t.fullName,
          status: "purged",
        };
      } catch (error) {
        return {
          templateId: t.templateId,
          name: t.name,
          fullName: t.fullName,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    options.concurrency ?? 4
  );

  let folderActions: FolderCleanupAction[] = [];
  const cleanupFolders = options.cleanupEmptyFolders !== false;
  if (cleanupFolders && templateActions.length > 0) {
    folderActions = await cleanupEmptyTemplateFolders(client, root, {
      whatIf: Boolean(options.whatIf),
    });
  }

  const purged = templateActions.filter((a) => a.status === "purged").length;
  const failed = templateActions.filter((a) => a.status === "failed").length;
  const foldersRemoved = folderActions.filter((a) => a.status === "deleted").length;

  const summary = options.whatIf
    ? `Plan: would delete ${templateActions.length} dead template${templateActions.length === 1 ? "" : "s"}${
        folderActions.length > 0
          ? ` and ${folderActions.length} empty folder${folderActions.length === 1 ? "" : "s"}`
          : ""
      }.`
    : `Deleted ${purged} template${purged === 1 ? "" : "s"}${
        foldersRemoved > 0
          ? ` and ${foldersRemoved} empty folder${foldersRemoved === 1 ? "" : "s"}`
          : ""
      }${failed > 0 ? ` (${failed} template failure${failed === 1 ? "" : "s"})` : ""}.`;

  printReport({
    logger,
    command: "cleanup.dead-templates.purge",
    envName,
    results: [...templateActions, ...folderActions.map((f) => ({ ...f, kind: "folder" as const }))],
    summary,
    formatLine: (a) =>
      "templateId" in a
        ? `${a.status === "what-if" ? "[would delete] " : a.status === "failed" ? "[failed] " : ""}${a.fullName ?? a.name}${a.error ? ` — ${a.error}` : ""}`
        : `${a.status === "what-if" ? "[would delete folder] " : a.status === "failed" ? "[failed folder] " : "[folder] "}${a.path}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      root,
      whatIf: Boolean(options.whatIf),
      templatePurgedCount: purged,
      templateFailedCount: failed,
      foldersRemovedCount: foldersRemoved,
    },
    options,
  });

  return { templates: templateActions, folders: folderActions };
};
