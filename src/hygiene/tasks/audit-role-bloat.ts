import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditRoleBloatOptions extends HygieneCommonOptions {
  /** Role-count threshold per user. Default 10. */
  threshold?: number;
  /** Cap on users inspected. Default 5000. */
  limit?: number;
  /**
   * Include administrators in the audit. Off by default — admins
   * legitimately accumulate roles for emergency-access reasons.
   */
  includeAdmins?: boolean;
  concurrency?: number;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface RoleBloatReport {
  user: string;
  isAdministrator: boolean;
  roleCount: number;
  roles: string[];
}

/**
 * Audit users with an unusually large number of role memberships.
 *
 * Strategy:
 *   1. List every user via `listUsers`.
 *   2. For each, fetch full detail (`getUserDetail`) to count
 *      direct role memberships.
 *   3. Flag users with `roleCount >= --threshold` (default 10).
 *
 * Notes:
 *   - This counts DIRECT memberships only — transitive roles (a user
 *     in role A, where role A is a member of role B) aren't summed.
 *     The Authoring API exposes `User.roles` as the direct set.
 *   - Administrators are excluded by default; pass `--include-admins`
 *     to include them.
 *   - The Authoring API doesn't expose role-permission detail per
 *     item, so this audit is a count signal, not an actual
 *     permission analysis.
 */
export const runAuditRoleBloat = async (
  options: AuditRoleBloatOptions
): Promise<RoleBloatReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  const threshold = options.threshold ?? 10;
  const limit = options.limit ?? 5000;
  const includeAdmins = Boolean(options.includeAdmins);
  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;

  const users = await client.listUsers();
  const bounded = users.slice(0, limit);
  logger.verbose(`Inspecting ${bounded.length} users (concurrency ${concurrency}).`);

  const details = await mapWithConcurrency(
    bounded,
    async (u) => {
      if (!includeAdmins && u.isAdministrator) return null;
      const detail = await client.getUserDetail(u.name);
      return detail;
    },
    concurrency
  );

  const reports: RoleBloatReport[] = details
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .filter((d) => d.roles.length >= threshold)
    .map((d) => ({
      user: d.name,
      isAdministrator: d.isAdministrator,
      roleCount: d.roles.length,
      roles: d.roles,
    }))
    .sort((a, b) => b.roleCount - a.roleCount);

  printReport({
    logger,
    command: "audit.role-bloat.list",
    envName,
    results: reports,
    summary: `Inspected ${bounded.length} users; ${reports.length} with >= ${threshold} role membership${threshold === 1 ? "" : "s"}.`,
    formatLine: (r) => `${r.user} — ${r.roleCount} roles`,
    extra: { threshold, scannedCount: bounded.length },
    options,
  });

  return reports;
};
