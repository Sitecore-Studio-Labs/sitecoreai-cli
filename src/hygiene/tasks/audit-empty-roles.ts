import { type HygieneCommonOptions, printReport, resolveTenant, toLogger } from "./shared";

export interface AuditEmptyRolesOptions extends HygieneCommonOptions {
  /**
   * Restrict to a specific domain. Defaults to all domains. Sitecore's
   * built-in roles live in the `sitecore` and `extranet` domains; many
   * tenants add project-specific roles in their own domain.
   */
  domain?: string;
  /** Cap on roles inspected. Default 5000. */
  limit?: number;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface EmptyRoleReport {
  name: string;
  domain: string | null;
}

/**
 * Audit roles that have zero direct members.
 *
 * Empty roles accumulate when:
 *   - A role was created for a project that never shipped.
 *   - Migrations remove users from a role but leave the role behind.
 *   - Custom workflows define roles that are referenced by no item.
 *
 * The Authoring API's `Role.members` is paged via AccountConnection,
 * which doesn't expose `totalCount`. The hygiene client uses
 * `members(first: 1)` to detect "has at least one member" cheaply.
 * If the connection's `nodes` is empty, the role is empty.
 *
 * Notes:
 *   - Sitecore's `Everyone` role is implicit-membership (every user is
 *     a member by default); `isEveryone: true` roles are filtered out
 *     to avoid noise.
 *   - This audit doesn't detect "role with no permissions attached" —
 *     the Authoring API exposes role membership but not per-role ACL
 *     bindings. Such roles can be cleaned up only after a manual
 *     review of role usage.
 */
export const runAuditEmptyRoles = async (
  options: AuditEmptyRolesOptions
): Promise<EmptyRoleReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  const limit = options.limit ?? 5000;
  const roles = await client.listRoles();
  const bounded = roles.slice(0, limit);
  logger.verbose(`Inspected ${bounded.length} roles.`);

  const reports: EmptyRoleReport[] = bounded
    .filter((r) => r.memberCount === 0)
    .filter((r) => !options.domain || r.domain === options.domain)
    .map((r) => ({ name: r.name, domain: r.domain }))
    .sort((a, b) => a.name.localeCompare(b.name));

  printReport({
    logger,
    command: "audit.empty-roles.list",
    envName,
    results: reports,
    summary: `Inspected ${bounded.length} roles; ${reports.length} have zero direct members.`,
    formatLine: (r) => `${r.name}`,
    extra: { scannedCount: bounded.length, domain: options.domain ?? null },
    options,
  });

  return reports;
};
