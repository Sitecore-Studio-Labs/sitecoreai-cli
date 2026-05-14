import readline from "node:readline";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import { runAuditDuplicates, type DuplicatesGroup } from "./audit-duplicates";
import {
  type HygieneCommonOptions,
  dashifyItemId,
  ensureAllowWriteForCleanup,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

export type DuplicatesKeepRule = "oldest" | "newest" | "shortest-path" | "interactive";

export interface CleanupDuplicatesOptions extends HygieneCommonOptions {
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  includeSystemFields?: boolean;
  language?: string;
  batchSize?: number;
  minGroupSize?: number;
  /**
   * Which member of each duplicate group survives. Default `oldest`
   * (created-date) — the original wins, most likely the one with
   * inbound refs.
   */
  keepRule?: DuplicatesKeepRule;
  /** Concurrency for delete calls. Default 4. */
  concurrency?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
  /** Required when `keepRule === "interactive"` and stdin isn't a TTY. */
  nonInteractive?: boolean;
}

export interface DuplicatePurgeAction {
  contentHash: string;
  kept: {
    itemId: string;
    path: string;
  };
  deleted: Array<{
    itemId: string;
    path: string;
    status: "deleted" | "what-if" | "failed";
    error?: string;
  }>;
}

const pickByRule = (
  group: DuplicatesGroup,
  rule: Exclude<DuplicatesKeepRule, "interactive">
): { kept: DuplicatesGroup["members"][number]; rest: DuplicatesGroup["members"] } => {
  const sorted = [...group.members];
  switch (rule) {
    case "oldest":
      sorted.sort((a, b) => {
        const aT = a.createdDate ? Date.parse(a.createdDate) : Number.POSITIVE_INFINITY;
        const bT = b.createdDate ? Date.parse(b.createdDate) : Number.POSITIVE_INFINITY;
        return aT - bT;
      });
      break;
    case "newest":
      sorted.sort((a, b) => {
        const aT = a.updatedDate ? Date.parse(a.updatedDate) : 0;
        const bT = b.updatedDate ? Date.parse(b.updatedDate) : 0;
        return bT - aT;
      });
      break;
    case "shortest-path":
      sorted.sort((a, b) => {
        const lenDiff = a.path.length - b.path.length;
        return lenDiff !== 0 ? lenDiff : a.path.localeCompare(b.path);
      });
      break;
  }
  return { kept: sorted[0], rest: sorted.slice(1) };
};

const promptForKeep = async (
  group: DuplicatesGroup
): Promise<{ kept: DuplicatesGroup["members"][number]; rest: DuplicatesGroup["members"] }> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`\nDuplicate group [${group.contentHash}] — ${group.count} copies:\n`);
    group.members.forEach((m, i) => {
      process.stdout.write(
        `  [${i + 1}] ${m.path}${m.createdDate ? ` (created ${m.createdDate.slice(0, 10)})` : ""}\n`
      );
    });
    process.stdout.write(`  [s]kip group\nKeep which? [1-${group.members.length}/s]: `);
    const answer = await new Promise<string>((resolve) =>
      rl.question("", (a) => resolve(a.trim().toLowerCase()))
    );
    if (answer === "s" || answer === "skip") {
      // Skip = keep first, delete none (signaled by returning empty rest).
      return { kept: group.members[0], rest: [] };
    }
    const idx = parseInt(answer, 10) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= group.members.length) {
      throw createScaiError(
        `Invalid selection '${answer}' for group ${group.contentHash}.`,
        "INPUT_INVALID"
      );
    }
    return {
      kept: group.members[idx],
      rest: group.members.filter((_, i) => i !== idx),
    };
  } finally {
    rl.close();
  }
};

/**
 * Purge duplicate items, keeping one per group according to `--keep-rule`.
 *
 * Strategy:
 *   1. Run `audit duplicates` to find groups.
 *   2. For each group, apply the keep-rule to pick the survivor.
 *   3. Delete the rest via `deleteItem(permanently: true)`.
 *
 * Notes:
 *   - **Inbound refs to deleted dupes become broken.** Run
 *     `audit broken-links list` after a purge — the duplicates that
 *     other content pointed to leave dangling references behind.
 *   - With `--keep-rule interactive`, the command prompts per group.
 *     Honors `s`/`skip` per-group to leave a group untouched.
 *     Requires a TTY; pass any other keep-rule when scripting.
 */
export const runCleanupDuplicates = async (
  options: CleanupDuplicatesOptions
): Promise<DuplicatePurgeAction[]> => {
  const logger = toLogger(options);
  const keepRule = options.keepRule ?? "oldest";

  if (keepRule === "interactive") {
    if (!process.stdin.isTTY || options.nonInteractive) {
      throw createScaiError(
        "--keep-rule interactive requires a TTY (cannot run with --non-interactive or piped stdin).",
        "INPUT_INVALID",
        { hint: "Pass --keep-rule oldest|newest|shortest-path for CI / agent use." }
      );
    }
  }

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no items will be deleted.", "yellow");
  }

  // Reuse audit to find groups.
  const groups = await runAuditDuplicates({ ...options, json: true, quiet: true });

  const actions: DuplicatePurgeAction[] = [];
  for (const group of groups) {
    let selection: { kept: DuplicatesGroup["members"][number]; rest: DuplicatesGroup["members"] };
    if (keepRule === "interactive") {
      selection = await promptForKeep(group);
    } else {
      selection = pickByRule(group, keepRule);
    }
    const action: DuplicatePurgeAction = {
      contentHash: group.contentHash,
      kept: { itemId: selection.kept.itemId, path: selection.kept.path },
      deleted: [],
    };
    // Apply deletes (or stage them under what-if).
    const deleteResults = await mapWithConcurrency(
      selection.rest,
      async (m) => {
        if (options.whatIf) {
          return { itemId: m.itemId, path: m.path, status: "what-if" as const };
        }
        try {
          await client.deleteItem({
            itemId: dashifyItemId(m.itemId),
            permanently: true,
          });
          return { itemId: m.itemId, path: m.path, status: "deleted" as const };
        } catch (error) {
          return {
            itemId: m.itemId,
            path: m.path,
            status: "failed" as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      options.concurrency ?? 4
    );
    action.deleted = deleteResults;
    actions.push(action);
  }

  const totalDeleted = actions.reduce(
    (n, a) => n + a.deleted.filter((d) => d.status === "deleted").length,
    0
  );
  const totalFailed = actions.reduce(
    (n, a) => n + a.deleted.filter((d) => d.status === "failed").length,
    0
  );
  const summary = options.whatIf
    ? `Plan: would delete ${actions.reduce((n, a) => n + a.deleted.length, 0)} duplicate item${actions.reduce((n, a) => n + a.deleted.length, 0) === 1 ? "" : "s"} across ${actions.length} group${actions.length === 1 ? "" : "s"} (keep-rule: ${keepRule}).`
    : `Deleted ${totalDeleted} duplicate${totalDeleted === 1 ? "" : "s"} across ${actions.length} group${actions.length === 1 ? "" : "s"} (keep-rule: ${keepRule})${totalFailed > 0 ? `; ${totalFailed} failed` : ""}.`;

  printReport({
    logger,
    command: "cleanup.duplicates.purge",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `[${a.contentHash}] keep ${a.kept.path}; deleted ${a.deleted
        .map((d) => `${d.status === "deleted" ? "" : `[${d.status}] `}${d.path}`)
        .join(", ")}`,
    extra: {
      keepRule,
      whatIf: Boolean(options.whatIf),
      groupCount: actions.length,
      deletedCount: totalDeleted,
      failedCount: totalFailed,
    },
    options,
  });

  return actions;
};
