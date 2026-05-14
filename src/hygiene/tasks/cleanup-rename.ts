import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  dashifyItemId,
  ensureAllowWriteForCleanup,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface CleanupRenameOptions extends HygieneCommonOptions {
  /**
   * Required. Pattern to match against item names. JS regex by default;
   * pass `--literal` to escape the input.
   */
  pattern: string;
  /**
   * Required. Replacement string. Supports JS RegExp backreferences
   * (`$1`, `$&`, `$<group>`). Use `$$` for a literal `$`.
   */
  replacement: string;
  literal?: boolean;
  ignoreCase?: boolean;
  flags?: string;
  /** Restrict by template name pattern. Recommended. */
  templatePattern?: string;
  /** Content-tree root. Default `/sitecore/content`. */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  exclude?: string[];
  since?: string;
  owner?: string;
  whatIf?: boolean;
  allowWrite?: boolean;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
  /**
   * Maximum number of items renamed per run. Default 100. Renames mutate
   * paths — a stray match against `Page1`/`Page2`/... could thousand-fold
   * the site map. Cap is intentionally low.
   */
  maxRenames?: number;
}

export interface RenameAction {
  itemId: string;
  oldPath: string;
  oldName: string;
  newName: string;
  newPath: string;
  templateName: string | null;
  status: "applied" | "what-if" | "failed" | "skipped-no-change" | "skipped-shape";
  error?: string;
}

const compilePattern = (
  pattern: string,
  options: { literal?: boolean; ignoreCase?: boolean; flags?: string }
): RegExp => {
  if (!pattern) {
    throw createScaiError("--pattern is required.", "INPUT_INVALID");
  }
  const baseFlags = options.flags ?? "";
  let flags = baseFlags;
  if (options.ignoreCase && !flags.includes("i")) flags += "i";
  // Intentionally NOT adding `g` — `name.replace(pattern, ...)` should
  // match once on the name string (names are short; global replace
  // creates surprising results for patterns like `[0-9]+`).
  const escaped = options.literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
  return new RegExp(escaped, flags);
};

/**
 * Bulk-rename items by pattern.
 *
 * Strategy:
 *   1. Scan via `scanItemsAndFields(skipFields: true)` — we only need
 *      the item's name + path.
 *   2. For each item, compute `newName = oldName.replace(pattern, replacement)`.
 *   3. Validate the new name: no slashes, non-empty, ≠ old name.
 *   4. Call `client.renameItem({itemId, name: newName})`.
 *
 * Safety rails:
 *   - `--what-if` reports without writing.
 *   - `--allow-write` required outside what-if.
 *   - `--max-renames` caps the blast radius (default 100).
 *   - `--template-pattern` is strongly recommended; renaming items by
 *     a generic name pattern across every template is rarely the
 *     intent.
 *
 * Notes:
 *   - The Authoring API's `updateItem(name: …)` rejects slashes in
 *     names (resolves to an unreachable path). We reject up-front.
 *   - Renaming changes the URL slug of pages — coordinate with
 *     redirects / sitemap regeneration in the surrounding workflow.
 *   - Display name (`__Display Name`) is a separate field; this verb
 *     does NOT touch it. Use `cleanup field-set --field "__Display Name"`
 *     when the operator wants the editor-visible name to change too.
 */
export const runCleanupRename = async (options: CleanupRenameOptions): Promise<RenameAction[]> => {
  const logger = toLogger(options);
  if (!options.pattern) {
    throw createScaiError("--pattern is required.", "INPUT_INVALID");
  }
  if (options.replacement === undefined || options.replacement === null) {
    throw createScaiError("--replacement is required.", "INPUT_INVALID");
  }
  const regex = compilePattern(options.pattern, options);
  const templateRegex = options.templatePattern ? new RegExp(options.templatePattern, "i") : null;
  const maxRenames = options.maxRenames ?? 100;

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no items will be renamed.", "yellow");
  }

  const { scanned, cache, knobs } = await scanItemsAndFields({
    client,
    envName,
    root: options.root ?? "/sitecore/content",
    logger,
    options,
    skipFields: true,
  });

  type Plan = {
    item: (typeof scanned)[number];
    newName: string;
    skip?: RenameAction["status"];
  };
  const plans: Plan[] = [];
  for (const item of scanned) {
    if (templateRegex && !templateRegex.test(item.templateName ?? "")) continue;
    const newName = item.name.replace(regex, options.replacement);
    if (newName === item.name) continue;
    let skip: RenameAction["status"] | undefined;
    if (!newName.trim()) {
      skip = "skipped-shape";
    } else if (/[/\\]/.test(newName)) {
      skip = "skipped-shape";
    }
    plans.push({ item, newName, ...(skip && { skip }) });
    if (plans.filter((p) => !p.skip).length >= maxRenames) {
      logger.warn(
        `Hit --max-renames cap (${maxRenames}); ${scanned.length - plans.length} item(s) skipped. Re-run with a higher cap to widen.`
      );
      break;
    }
  }

  const actions: RenameAction[] = await mapWithConcurrency(
    plans,
    async (plan): Promise<RenameAction> => {
      const oldPath = plan.item.path;
      const lastSlash = oldPath.lastIndexOf("/");
      const newPath = lastSlash >= 0 ? `${oldPath.slice(0, lastSlash)}/${plan.newName}` : oldPath;
      const base: Omit<RenameAction, "status" | "error"> = {
        itemId: plan.item.itemId,
        oldPath,
        oldName: plan.item.name,
        newName: plan.newName,
        newPath,
        templateName: plan.item.templateName,
      };
      if (plan.skip) return { ...base, status: plan.skip };
      if (options.whatIf) return { ...base, status: "what-if" };
      try {
        await client.renameItem({
          itemId: dashifyItemId(plan.item.itemId),
          name: plan.newName,
        });
        return { ...base, status: "applied" };
      } catch (error) {
        return {
          ...base,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    knobs.concurrency
  );

  await cache?.flush();

  const applied = actions.filter((a) => a.status === "applied").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const summary = options.whatIf
    ? `Plan: would rename ${actions.filter((a) => a.status === "what-if").length} item(s).`
    : `Renamed ${applied} item(s)${failed > 0 ? `; ${failed} failed` : ""}.`;

  printReport({
    logger,
    command: "cleanup.rename",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "applied" ? "" : `[${a.status}] `}${a.oldPath} → ${a.newName}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      pattern: options.pattern,
      replacement: options.replacement,
      literal: Boolean(options.literal),
      ignoreCase: Boolean(options.ignoreCase),
      whatIf: Boolean(options.whatIf),
      maxRenames,
      appliedCount: applied,
      failedCount: failed,
    },
    options,
  });

  return actions;
};
