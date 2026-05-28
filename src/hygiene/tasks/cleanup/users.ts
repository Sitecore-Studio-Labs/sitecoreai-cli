import { mapWithConcurrency } from "@/shared/cli-tasks";
import { runAuditStaleUsers } from "../audit/stale-users";
import {
  type HygieneCommonOptions,
  ensureAllowWrite,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "../shared";

export interface CleanupUsersOptions extends HygieneCommonOptions {
  /** Inactivity threshold in days. Default 365 (one year). */
  notActiveDays?: number;
  /** Cap on deletions. Default 25. */
  maxDeletions?: number;
  /** Include administrators. Strongly discouraged. */
  includeAdmins?: boolean;
  /** Include service accounts (regex match). Off by default. */
  includeServiceAccounts?: boolean;
  /** Use UserProfile.lastActivityDate instead of lastLoginDate. */
  useActivityDate?: boolean;
  concurrency?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface UserCleanupAction {
  user: string;
  daysSinceActive: number | null;
  status: "deleted" | "what-if" | "failed";
  error?: string;
}

/**
 * Purge stale users. Pairs with `audit stale-users list`.
 *
 * Safety rails:
 *   - Default threshold is **one year** (365 days), much higher than
 *     the audit's 180 default. Deleting users is more destructive
 *     than flagging them.
 *   - `--max-deletions` defaults to 25 per run (vs. 100 in
 *     find-replace) — same reasoning.
 *   - Administrators excluded by default; pass `--include-admins`
 *     with caution.
 *   - Service accounts excluded by default; OAuth client-credentials
 *     auth doesn't update `lastLoginDate` so service accounts will
 *     ALWAYS look stale.
 *   - `--allow-write` (or env `allowWrite`) required outside `--what-if`.
 *
 * Notes:
 *   - The Authoring API's `deleteUser` mutation removes the user.
 *     Items the user authored aren't deleted (they're owned by the
 *     tenant), but `__Created by` / `__Updated by` references become
 *     stale strings rather than resolvable user accounts.
 */
export const runCleanupUsers = async (
  options: CleanupUsersOptions
): Promise<UserCleanupAction[]> => {
  const logger = toLogger(options);
  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWrite(rootConfig, envName, options.allowWrite, "cleanup-users");
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no users will be deleted.", "yellow");
  }

  const days = options.notActiveDays ?? 365;
  const maxDeletions = options.maxDeletions ?? 25;

  const stale = await runAuditStaleUsers({
    ...options,
    notActiveDays: days,
    includeAdmins: options.includeAdmins,
    includeServiceAccounts: options.includeServiceAccounts,
    useActivityDate: options.useActivityDate,
    json: true,
    quiet: true,
  });

  const targets = stale.slice(0, maxDeletions);
  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;

  const actions: UserCleanupAction[] = await mapWithConcurrency(
    targets,
    async (u): Promise<UserCleanupAction> => {
      if (options.whatIf) {
        return { user: u.user, daysSinceActive: u.daysSinceActive, status: "what-if" };
      }
      try {
        await client.deleteUser(u.user);
        return { user: u.user, daysSinceActive: u.daysSinceActive, status: "deleted" };
      } catch (error) {
        return {
          user: u.user,
          daysSinceActive: u.daysSinceActive,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    concurrency
  );

  const deleted = actions.filter((a) => a.status === "deleted").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const summary = options.whatIf
    ? `Plan: would delete ${actions.length} stale user${actions.length === 1 ? "" : "s"} (inactive > ${days} days).`
    : `Deleted ${deleted} user${deleted === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}.`;

  printReport({
    logger,
    command: "cleanup.users.purge-stale",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "what-if" ? "[would delete] " : a.status === "failed" ? "[failed] " : ""}${a.user} — ${a.daysSinceActive === null ? "never active" : `${a.daysSinceActive}d`}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      notActiveDays: days,
      whatIf: Boolean(options.whatIf),
      maxDeletions,
      deletedCount: deleted,
      failedCount: failed,
    },
    options,
  });

  return actions;
};
