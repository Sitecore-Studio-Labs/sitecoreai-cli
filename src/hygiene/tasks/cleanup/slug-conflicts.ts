import readline from "node:readline";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import { runAuditReferences } from "../audit/references";
import { runAuditSlugConflicts, type SlugConflictGroup } from "../audit/slug-conflicts";
import {
  type HygieneCommonOptions,
  dashifyItemId,
  ensureAllowWrite,
  printReport,
  resolveTenant,
  toLogger,
} from "../shared";

export type SlugConflictsKeepRule = "oldest" | "newest" | "shortest-path" | "interactive";

export type SlugConflictsAction = "delete" | "rename";

export interface CleanupSlugConflictsOptions extends HygieneCommonOptions {
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  language?: string;
  pageParallelism?: number;
  exclude?: string[];
  since?: string;
  owner?: string;
  caseInsensitive?: boolean;
  /**
   * Which member of each conflict group survives. Default `oldest`
   * (the survivor is whichever sibling was created first). `newest`
   * keeps the most-recently-updated sibling; `shortest-path` keeps the
   * one whose full path is shortest (rare tie-breaker — useful when
   * one sibling is at the canonical depth and others are buried).
   * `interactive` prompts per group; requires a TTY.
   */
  keepRule?: SlugConflictsKeepRule;
  /**
   * What to do with the losers. `delete` (default) calls
   * `deleteItem(permanently: true)`. `rename` keeps the item but
   * renames it to `${name}${suffix}` where suffix is auto-generated
   * from the itemId (8-char prefix) so subsequent runs don't re-collide.
   * Rename preserves inbound refs (the itemId is unchanged) at the cost
   * of leaving stale-named siblings around the parent — operators
   * picking between the two should think about whether broken refs or
   * stale names are worse for their tenant.
   */
  action?: SlugConflictsAction;
  /**
   * Override the auto-generated rename suffix. Use `{shortId}` as a
   * placeholder for the loser's 8-char itemId prefix, `{full}` for the
   * full 32-char id. Default: `-{shortId}`. Ignored when
   * `--action delete`.
   */
  renameSuffix?: string;
  /** Concurrency for delete/rename calls. Default 4. */
  concurrency?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
  /** Required when `keepRule === "interactive"` and stdin isn't a TTY. */
  nonInteractive?: boolean;
  /**
   * Pre-action inbound-reference check. When true, runs
   * `audit references --to <itemId>` against every loser BEFORE the
   * resolve phase. Behavior depends on mode:
   *
   *   - **Preview (`whatIf: true`):** counts attach to each resolved
   *     row as `inboundRefs`. Warn-only — never aborts.
   *   - **Apply (`whatIf: false`):** if any loser has positive count,
   *     the whole run aborts with INPUT_INVALID listing the blockers.
   *     The implicit safety net for "you're about to break N inbound
   *     refs."
   *
   * Cost: one `audit references` scan per loser. Uses `cache: true` so
   * the underlying field reads are shared across scans (large blast-
   * radius runs are cheaper than naive O(N) implies). Off by default
   * — operators who care opt in.
   */
  checkRefs?: boolean;
  /**
   * Content root the inbound-ref check scans. Default `/sitecore` to
   * cover refs from anywhere on the tenant. Narrow if you know refs
   * to losing items can only come from a subtree (e.g. `/sitecore/content`).
   * Ignored when `checkRefs` is unset.
   */
  refCheckRoot?: string;
}

export interface SlugConflictPurgeAction {
  parentPath: string;
  slug: string;
  kept: {
    itemId: string;
    path: string;
  };
  resolved: Array<{
    itemId: string;
    path: string;
    /** `delete` losers get `permanently: true`. `rename` losers get a new sibling name. */
    action: SlugConflictsAction;
    /** Only set on `rename`. The new item name (not the full path). */
    newName?: string;
    /**
     * Inbound-reference count from the optional `checkRefs` pre-scan.
     * Set when the caller passed `checkRefs: true`; omitted otherwise.
     * Surfaced in preview output so operators can see "I'm about to
     * break N refs." In apply mode a positive count aborts the run.
     */
    inboundRefs?: number;
    status: "applied" | "what-if" | "failed";
    error?: string;
  }>;
}

const pickByRule = (
  group: SlugConflictGroup,
  rule: Exclude<SlugConflictsKeepRule, "interactive">
  // The audit-side report doesn't carry createdDate/updatedDate. For
  // `oldest`/`newest` we fall back to itemId-stable ordering (smallest
  // itemId wins for `oldest`, largest for `newest`) — not perfect, but
  // deterministic across runs so baseline fingerprints stay stable.
): { kept: SlugConflictGroup["members"][number]; rest: SlugConflictGroup["members"] } => {
  const sorted = [...group.members];
  switch (rule) {
    case "oldest":
      sorted.sort((a, b) => a.itemId.localeCompare(b.itemId));
      break;
    case "newest":
      sorted.sort((a, b) => b.itemId.localeCompare(a.itemId));
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
  group: SlugConflictGroup
): Promise<{ kept: SlugConflictGroup["members"][number]; rest: SlugConflictGroup["members"] }> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(
      `\nSlug conflict at ${group.parentPath}/${group.slug}* — ${group.count} siblings:\n`
    );
    group.members.forEach((m, i) => {
      process.stdout.write(
        `  [${i + 1}] ${m.path}${m.language ? ` (${m.language})` : ""}${m.templateName ? ` [${m.templateName}]` : ""}\n`
      );
    });
    process.stdout.write(`  [s]kip group\nKeep which? [1-${group.members.length}/s]: `);
    const answer = await new Promise<string>((resolve) =>
      rl.question("", (a) => resolve(a.trim().toLowerCase()))
    );
    if (answer === "s" || answer === "skip") {
      // Skip = keep first, resolve none.
      return { kept: group.members[0], rest: [] };
    }
    const idx = parseInt(answer, 10) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= group.members.length) {
      throw createScaiError(
        `Invalid selection '${answer}' for group ${group.parentPath}/${group.slug}.`,
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

const renderSuffix = (template: string, itemId: string): string => {
  const flat = itemId.replace(/[-{}]/g, "").toLowerCase();
  const shortId = flat.slice(0, 8);
  return template.replace(/\{shortId\}/g, shortId).replace(/\{full\}/g, flat);
};

/**
 * Resolve sibling-name conflicts surfaced by `audit slug-conflicts`.
 *
 * Strategy:
 *   1. Run `audit slug-conflicts` to find groups of siblings sharing
 *      a name (case-insensitive by default — match the audit).
 *   2. For each group, pick the survivor per `--keep-rule`.
 *   3. Resolve the losers via `--action`:
 *        - `delete` — `deleteItem(permanently: true)` (default).
 *        - `rename` — `renameItem({ name: oldName + suffix })`. The
 *          suffix template defaults to `-{shortId}` so renamed items
 *          stay traceable to their itemId.
 *
 * Notes:
 *   - **Inbound refs.** Deletes turn refs into broken links — run
 *     `audit broken-links list` after a delete pass. Renames preserve
 *     inbound refs (the itemId doesn't change), but URLs depending on
 *     the old slug break.
 *   - The audit's report has no createdDate/updatedDate, so the
 *     `oldest`/`newest` rules fall back to itemId-stable ordering. This
 *     is deterministic across runs (so baselines stay valid) but isn't
 *     literally creation-date sorted. Use `interactive` when the
 *     decision matters per-item.
 *   - With `--keep-rule interactive`, the command prompts per group.
 *     Honors `s`/`skip` to leave a group untouched. Requires a TTY;
 *     pass any other keep-rule when scripting.
 */
export const runCleanupSlugConflicts = async (
  options: CleanupSlugConflictsOptions
): Promise<SlugConflictPurgeAction[]> => {
  const logger = toLogger(options);
  const keepRule = options.keepRule ?? "oldest";
  const action = options.action ?? "delete";
  const suffixTemplate = options.renameSuffix ?? "-{shortId}";

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
    ensureAllowWrite(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no items will be deleted or renamed.", "yellow");
  }

  // Reuse audit to find groups. Pass through scan-shaping options so
  // the cleanup respects the same scope the operator audited with.
  const groups = await runAuditSlugConflicts({
    ...options,
    json: true,
    quiet: true,
  });

  // Phase 1: pick survivors per group. Sequential because `interactive`
  // mode prompts on stdin and parallel prompts are bad UX; the
  // non-interactive keep rules are pure functions either way.
  type Selection = {
    kept: SlugConflictGroup["members"][number];
    rest: SlugConflictGroup["members"];
  };
  const plans: Array<{ group: SlugConflictGroup; selection: Selection }> = [];
  for (const group of groups) {
    const selection =
      keepRule === "interactive" ? await promptForKeep(group) : pickByRule(group, keepRule);
    plans.push({ group, selection });
  }

  // Phase 2 (optional): inbound-ref check per loser. The audit's cache
  // (`cache: true`) shares field reads across scans, so the cost is
  // amortized when multiple losers live under the same content root.
  // Strip `output`/`format` from the forwarded options so the audit
  // doesn't try to write to the cleanup's output target.
  const refCounts = new Map<string, number>();
  if (options.checkRefs) {
    const losers = plans.flatMap((p) => p.selection.rest);
    const refOptions = {
      ...options,
      output: undefined,
      format: undefined,
      json: true,
      quiet: true,
      cache: true,
      root: options.refCheckRoot ?? "/sitecore",
    };
    await mapWithConcurrency(
      losers,
      async (m) => {
        const refs = await runAuditReferences({
          ...refOptions,
          to: dashifyItemId(m.itemId),
        });
        refCounts.set(m.itemId, refs.length);
      },
      options.concurrency ?? 4
    );
    if (!options.whatIf) {
      const blockers = losers
        .map((m) => ({ ...m, refs: refCounts.get(m.itemId) ?? 0 }))
        .filter((m) => m.refs > 0);
      if (blockers.length > 0) {
        const summary = blockers
          .slice(0, 5)
          .map((b) => `  ${b.path} (${b.refs} ref${b.refs === 1 ? "" : "s"})`)
          .join("\n");
        const more = blockers.length > 5 ? `\n  ...and ${blockers.length - 5} more` : "";
        throw createScaiError(
          `--check-refs gate: ${blockers.length} loser${blockers.length === 1 ? " has" : "s have"} inbound references. Resolve refs first or re-run without --check-refs:\n${summary}${more}`,
          "INPUT_INVALID"
        );
      }
    }
  }

  // Phase 3: resolve (delete or rename) per group.
  const actions: SlugConflictPurgeAction[] = [];
  for (const { group, selection } of plans) {
    const actionRecord: SlugConflictPurgeAction = {
      parentPath: group.parentPath,
      slug: group.slug,
      kept: { itemId: selection.kept.itemId, path: selection.kept.path },
      resolved: [],
    };
    const results = await mapWithConcurrency(
      selection.rest,
      async (m) => {
        // Attach the optional inbound-ref count built during phase 2.
        // Omitted (undefined) when --check-refs wasn't passed.
        const refField = options.checkRefs ? { inboundRefs: refCounts.get(m.itemId) ?? 0 } : {};
        if (action === "rename") {
          const newName = m.name + renderSuffix(suffixTemplate, m.itemId);
          if (newName === m.name) {
            return {
              itemId: m.itemId,
              path: m.path,
              action,
              newName,
              ...refField,
              status: "failed" as const,
              error: "rename suffix produced an unchanged name; pick a different --rename-suffix",
            };
          }
          if (options.whatIf) {
            return {
              itemId: m.itemId,
              path: m.path,
              action,
              newName,
              ...refField,
              status: "what-if" as const,
            };
          }
          try {
            await client.renameItem({
              itemId: dashifyItemId(m.itemId),
              name: newName,
            });
            return {
              itemId: m.itemId,
              path: m.path,
              action,
              newName,
              ...refField,
              status: "applied" as const,
            };
          } catch (error) {
            return {
              itemId: m.itemId,
              path: m.path,
              action,
              newName,
              ...refField,
              status: "failed" as const,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
        // action === "delete"
        if (options.whatIf) {
          return {
            itemId: m.itemId,
            path: m.path,
            action,
            ...refField,
            status: "what-if" as const,
          };
        }
        try {
          await client.deleteItem({
            itemId: dashifyItemId(m.itemId),
            permanently: true,
          });
          return {
            itemId: m.itemId,
            path: m.path,
            action,
            ...refField,
            status: "applied" as const,
          };
        } catch (error) {
          return {
            itemId: m.itemId,
            path: m.path,
            action,
            ...refField,
            status: "failed" as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      options.concurrency ?? 4
    );
    actionRecord.resolved = results;
    actions.push(actionRecord);
  }

  const totalApplied = actions.reduce(
    (n, a) => n + a.resolved.filter((r) => r.status === "applied").length,
    0
  );
  const totalFailed = actions.reduce(
    (n, a) => n + a.resolved.filter((r) => r.status === "failed").length,
    0
  );
  const totalPlanned = actions.reduce((n, a) => n + a.resolved.length, 0);
  const verb = action === "rename" ? "rename" : "delete";
  const verbPast = action === "rename" ? "Renamed" : "Deleted";
  const summary = options.whatIf
    ? `Plan: would ${verb} ${totalPlanned} sibling${totalPlanned === 1 ? "" : "s"} across ${actions.length} slug-conflict group${actions.length === 1 ? "" : "s"} (keep-rule: ${keepRule}).`
    : `${verbPast} ${totalApplied} sibling${totalApplied === 1 ? "" : "s"} across ${actions.length} slug-conflict group${actions.length === 1 ? "" : "s"} (keep-rule: ${keepRule})${totalFailed > 0 ? `; ${totalFailed} failed` : ""}.`;

  printReport({
    logger,
    command: "cleanup.slug-conflicts.purge",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.parentPath}/${a.slug}* keep ${a.kept.path}; ${a.resolved
        .map((r) => {
          const tag = r.status === "applied" ? "" : `[${r.status}] `;
          const target = r.action === "rename" ? `${r.path} → ${r.newName}` : r.path;
          const refs = r.inboundRefs !== undefined ? ` [${r.inboundRefs} refs]` : "";
          return `${tag}${target}${refs}`;
        })
        .join(", ")}`,
    extra: {
      keepRule,
      action,
      renameSuffix: action === "rename" ? suffixTemplate : undefined,
      whatIf: Boolean(options.whatIf),
      checkRefs: Boolean(options.checkRefs),
      groupCount: actions.length,
      appliedCount: totalApplied,
      failedCount: totalFailed,
    },
    options,
  });

  return actions;
};
