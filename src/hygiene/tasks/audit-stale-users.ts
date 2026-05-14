import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditStaleUsersOptions extends HygieneCommonOptions {
  /** Days since last activity. Default 180. */
  notActiveDays?: number;
  /** Cap on users inspected. Default 5000. */
  limit?: number;
  /** Include administrators. Off by default. */
  includeAdmins?: boolean;
  /**
   * Include service accounts (heuristic: user names ending in
   * `_service`, `_api`, or `service` substring). Off by default —
   * service accounts have no human-meaningful "last login"
   * because they authenticate via OAuth client credentials.
   */
  includeServiceAccounts?: boolean;
  /**
   * Use `lastActivityDate` instead of `lastLoginDate` for the
   * staleness check. Default `false` → use `lastLoginDate` which
   * reflects "has not logged into the admin UI." Activity date is a
   * broader signal that includes API-style polling.
   */
  useActivityDate?: boolean;
  concurrency?: number;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface StaleUserReport {
  user: string;
  domain: string | null;
  isAdministrator: boolean;
  lastLogin: string | null;
  lastActivity: string | null;
  daysSinceActive: number | null;
}

const SERVICE_ACCOUNT_RE = /(_service$|_api$|service|automation|robot|sync)/i;

/**
 * Audit users who have been inactive for N days.
 *
 * Strategy:
 *   1. List every user via `listUsers`.
 *   2. For each, fetch `getUserDetail` to read `profile.lastActivity`.
 *   3. Flag users where `lastActivity` is null OR older than N days.
 *
 * Notes:
 *   - The Authoring API's `UserProfile.lastActivity` reflects the
 *     last time the user logged into the Sitecore admin / Pages
 *     editor. It does NOT count CLI / Authoring-API access via
 *     OAuth client-credentials — service-style "users" therefore
 *     always appear stale, which is why the audit excludes likely
 *     service accounts by default.
 *   - Administrators are excluded by default; pass `--include-admins`
 *     to include them.
 */
export const runAuditStaleUsers = async (
  options: AuditStaleUsersOptions
): Promise<StaleUserReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  const days = options.notActiveDays ?? 180;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const includeAdmins = Boolean(options.includeAdmins);
  const includeServiceAccounts = Boolean(options.includeServiceAccounts);
  const limit = options.limit ?? 5000;
  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;

  const users = await client.listUsers();
  const bounded = users.slice(0, limit);
  logger.verbose(`Inspecting ${bounded.length} users.`);

  type Pair = {
    summary: (typeof bounded)[number];
    detail: NonNullable<Awaited<ReturnType<typeof client.getUserDetail>>> | null;
  };
  const pairs: Pair[] = await mapWithConcurrency(
    bounded,
    async (summary) => {
      if (!includeAdmins && summary.isAdministrator) return { summary, detail: null };
      if (!includeServiceAccounts && SERVICE_ACCOUNT_RE.test(summary.name))
        return { summary, detail: null };
      const detail = await client.getUserDetail(summary.name);
      return { summary, detail };
    },
    concurrency
  );

  const useActivity = Boolean(options.useActivityDate);
  const reports: StaleUserReport[] = pairs
    .filter(
      (p): p is { summary: (typeof bounded)[number]; detail: NonNullable<typeof p.detail> } =>
        p.detail != null
    )
    .filter((p) => {
      const value = useActivity ? p.detail.lastActivity : p.detail.lastLogin;
      if (!value) return true; // never active
      const t = Date.parse(value);
      return !Number.isFinite(t) || t < cutoff;
    })
    .map((p) => {
      const value = useActivity ? p.detail.lastActivity : p.detail.lastLogin;
      const t = value ? Date.parse(value) : NaN;
      return {
        user: p.summary.name,
        domain: p.summary.domain,
        isAdministrator: p.summary.isAdministrator,
        lastLogin: p.detail.lastLogin,
        lastActivity: p.detail.lastActivity,
        daysSinceActive: Number.isFinite(t)
          ? Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000))
          : null,
      };
    })
    .sort((a, b) => (b.daysSinceActive ?? Infinity) - (a.daysSinceActive ?? Infinity));

  printReport({
    logger,
    command: "audit.stale-users.list",
    envName,
    results: reports,
    summary: `Inspected ${bounded.length} users; ${reports.length} inactive > ${days} days.`,
    formatLine: (r) =>
      `${r.user} — ${r.daysSinceActive === null ? "never active" : `${r.daysSinceActive}d`}${r.lastActivity ? ` (${r.lastActivity.slice(0, 10)})` : ""}`,
    extra: { notActiveDays: days, scannedCount: bounded.length },
    options,
  });

  return reports;
};
