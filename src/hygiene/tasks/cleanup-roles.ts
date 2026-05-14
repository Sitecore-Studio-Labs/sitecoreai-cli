import { mapWithConcurrency } from "@/shared/cli-tasks";
import { runAuditEmptyRoles } from "./audit-empty-roles";
import {
  type HygieneCommonOptions,
  ensureAllowWriteForCleanup,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "./shared";

export interface CleanupRolesOptions extends HygieneCommonOptions {
  /** Restrict to a specific domain. */
  domain?: string;
  /** Cap on deletions. Default 50. */
  maxDeletions?: number;
  concurrency?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface RoleCleanupAction {
  name: string;
  domain: string | null;
  status: "deleted" | "what-if" | "failed";
  error?: string;
}

/**
 * Purge empty roles. Pairs with `audit empty-roles list`.
 *
 * Safety rails:
 *   - `--what-if` reports the plan without mutating.
 *   - `--allow-write` required outside `--what-if`.
 *   - `--max-deletions` caps per-run blast radius (default 50).
 *   - Sitecore built-in roles (sitecore\\Author, sitecore\\Developer,
 *     etc.) are surfaced by `audit empty-roles` only if they are
 *     genuinely empty. If they're empty by accident (after a user
 *     migration), deleting them breaks the platform's role model.
 *     Operators should review the audit output BEFORE running cleanup.
 *
 * Notes:
 *   - The Authoring API's `deleteRole` cascades — users in the role
 *     lose that membership. Empty roles have no members by definition,
 *     so no membership change.
 *   - Roles that are members of OTHER roles (via `Role.memberOf`)
 *     leave dangling memberships when deleted. We don't check that
 *     here; the cleanup is intentionally minimal.
 */
export const runCleanupRoles = async (
  options: CleanupRolesOptions
): Promise<RoleCleanupAction[]> => {
  const logger = toLogger(options);
  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no roles will be deleted.", "yellow");
  }

  const empty = await runAuditEmptyRoles({
    ...options,
    domain: options.domain,
    json: true,
    quiet: true,
  });

  const maxDeletions = options.maxDeletions ?? 50;
  const targets = empty.slice(0, maxDeletions);
  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;

  const actions: RoleCleanupAction[] = await mapWithConcurrency(
    targets,
    async (r): Promise<RoleCleanupAction> => {
      if (options.whatIf) {
        return { name: r.name, domain: r.domain, status: "what-if" };
      }
      try {
        await client.deleteRole(r.name);
        return { name: r.name, domain: r.domain, status: "deleted" };
      } catch (error) {
        return {
          name: r.name,
          domain: r.domain,
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
    ? `Plan: would delete ${actions.length} empty role${actions.length === 1 ? "" : "s"}.`
    : `Deleted ${deleted} role${deleted === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}.`;

  printReport({
    logger,
    command: "cleanup.roles.purge-empty",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "what-if" ? "[would delete] " : a.status === "failed" ? "[failed] " : ""}${a.name}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      domain: options.domain ?? null,
      whatIf: Boolean(options.whatIf),
      maxDeletions,
      deletedCount: deleted,
      failedCount: failed,
    },
    options,
  });

  return actions;
};
