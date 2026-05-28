import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  ensureAllowWrite,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "../shared";
import type { HygieneApiClient } from "../../api/client";

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
  /**
   * Additional template IDs to treat as folders, beyond the well-known
   * Sitecore folder templates. Accept any case + dashed/curly/flat
   * GUID form — values are normalised before comparison. Repeat or
   * comma-separate at the CLI layer.
   *
   * Without an allowlist, the cleanup would delete *any* leaf item
   * (Pages, Datasources, etc.) the moment its children were emptied —
   * the original implementation had exactly this footgun in production.
   */
  folderTemplateIds?: string[];
  /**
   * Treat any item whose template name matches this regular expression
   * as a folder for deletion purposes. Off by default. Use with care —
   * a permissive pattern (e.g. `.*Folder.*`) will sweep "Folder Settings"
   * or "Folder Mapping" templates alongside actual folders. The default
   * folder-id allowlist is the safer surface for most operators.
   */
  templateNamePattern?: string;
  /**
   * Disable the folder-template gate and revert to the pre-2026
   * behaviour of deleting any leaf item with zero children. Provided
   * only as an emergency escape hatch — pair with `--what-if` first
   * and a tightly scoped `--root` to avoid mass deletion of Page items.
   */
  anyTemplate?: boolean;
}

/**
 * Well-known Sitecore folder-template IDs. Normalised to lowercase /
 * dashes-stripped / no-curlies form so callers can compare cheaply
 * against the same shape returned by `getChildren`. Sourced from the
 * Sitecore platform constants:
 *
 *   - `{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}` Common/Folder
 *   - `{0437FEE2-44C9-46A6-ABE9-28858D9FEE8C}` System/Templates/Template folder
 *   - `{FE5DD826-48C6-436D-B87A-7C4210C7413B}` System/Media/Media folder
 *   - `{75CC5CB0-92CB-4ABD-BA7F-23A9B20D684D}` Common/Node
 *
 * Add new ids via `--folder-template-ids` rather than expanding this
 * set — different installs may have different conventions and we want
 * the default to err on safety.
 */
const WELL_KNOWN_FOLDER_TEMPLATE_IDS: ReadonlyArray<string> = [
  "a87a00b1e6db45ab8b54636fec3b5523",
  "0437fee244c946a6abe928858d9fee8c",
  "fe5dd82648c6436db87a7c4210c7413b",
  "75cc5cb092cb4abdba7f23a9b20d684d",
];

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
    ensureAllowWrite(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no folders will be deleted.", "yellow");
  }

  const maxDeletions = options.maxDeletions ?? 500;
  const folderTemplateIds = new Set<string>([
    ...WELL_KNOWN_FOLDER_TEMPLATE_IDS,
    ...(options.folderTemplateIds ?? []).map((id) => normalizeItemId(id)),
  ]);
  const templateNamePattern = options.templateNamePattern
    ? new RegExp(options.templateNamePattern, "i")
    : null;
  const anyTemplate = Boolean(options.anyTemplate);
  if (anyTemplate) {
    logger.warn(
      "--any-template is set — every leaf item with zero children will be deleted, regardless of template. Combine with --what-if and a tight --root."
    );
  }

  const isFolderLike = (child: {
    templateId: string | null;
    templateName: string | null;
  }): boolean => {
    if (anyTemplate) return true;
    if (child.templateId && folderTemplateIds.has(normalizeItemId(child.templateId))) return true;
    if (templateNamePattern && child.templateName && templateNamePattern.test(child.templateName))
      return true;
    return false;
  };

  const actions: EmptyFolderAction[] = [];
  let skippedNonFolder = 0;

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
        // The original behaviour deleted any leaf item with zero
        // children — a Page item whose children had just been removed
        // would silently disappear next run. Restrict deletions to the
        // folder-template allowlist (with an opt-in name pattern and a
        // hard escape via --any-template).
        if (!isFolderLike(child)) {
          skippedNonFolder += 1;
          logger.verbose(
            `Skipping ${child.path}: template ${child.templateName ?? child.templateId ?? "<unknown>"} is not in the folder allowlist.`
          );
          return false;
        }
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
      skippedNonFolderCount: skippedNonFolder,
      folderTemplateIds: [...folderTemplateIds],
      anyTemplate,
    },
    options,
  });

  return actions;
};
