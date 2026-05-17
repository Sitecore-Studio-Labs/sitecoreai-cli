import { mapWithConcurrency } from "@/shared/cli-tasks";
import { runAuditEmptyRoles } from "../audit/empty-roles";
import {
  type HygieneCommonOptions,
  ensureAllowWriteForCleanup,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "../shared";

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
  /**
   * Include Sitecore platform / built-in roles in the purge. Off by
   * default — built-in roles (Administrator, Author, every `Sitecore
   * Client …` role, every `Analytics …` and `Marketer …` role) ship
   * empty on a fresh tenant and remain empty until operators wire them
   * up; deleting them by mistake breaks the platform's role model and
   * the Items.AccessRights inheritance that depends on those roles
   * existing. Pass `--include-builtin` only after triple-checking the
   * audit output.
   */
  includeBuiltin?: boolean;
  /**
   * Additional role names to never delete, on top of the built-in skip
   * list. Match is case-insensitive and supports both the bare name and
   * the `domain\name` form.
   */
  alwaysSkip?: string[];
}

/**
 * Built-in Sitecore role names that ship with the platform. The set
 * covers:
 *   - Core admin roles (`Administrator`, `Designer`, `Developer`,
 *     `Everyone`).
 *   - The `Sitecore Client …` family (Authoring, Configuring, Forms
 *     Author, Maintaining, Publishing, Securing, Translating, Users).
 *   - The `Analytics …` and `Marketer …` reporting / personalization
 *     families.
 *   - The author role.
 *
 * The match is by lowercased bare name within the `sitecore\` domain.
 * Tenants that customise the role catalog can extend via `--always-skip`
 * or override globally with `--include-builtin`. Listing exact names
 * (rather than `sitecore\Sitecore *` prefix) keeps a customer-named
 * role like `sitecore\Sitecore Internal Team` out of the skip list.
 */
const BUILTIN_SITECORE_ROLES: ReadonlySet<string> = new Set([
  "administrator",
  "designer",
  "developer",
  "author",
  "everyone",
  "sitecore client account managing",
  "sitecore client authoring",
  "sitecore client configuring",
  "sitecore client designing",
  "sitecore client developing",
  "sitecore client forms author",
  "sitecore client maintaining",
  "sitecore client publishing",
  "sitecore client securing",
  "sitecore client translating",
  "sitecore client users",
  "sitecore local administrators",
  "sitecore marketing author",
  "sitecore marketing reporting",
  "marketer",
  "marketer limited",
  "marketer minimal",
  "analytics maintaining",
  "analytics reporting",
  "analytics personalization",
  "analytics testing",
]);

const splitRoleName = (raw: string): { domain: string | null; bareName: string } => {
  const idx = raw.indexOf("\\");
  if (idx < 0) return { domain: null, bareName: raw.toLowerCase() };
  return {
    domain: raw.slice(0, idx).toLowerCase(),
    bareName: raw.slice(idx + 1).toLowerCase(),
  };
};

const isBuiltinSitecoreRole = (name: string): boolean => {
  const { domain, bareName } = splitRoleName(name);
  if (domain && domain !== "sitecore") return false;
  return BUILTIN_SITECORE_ROLES.has(bareName);
};

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
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite, "cleanup-roles");
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no roles will be deleted.", "yellow");
  }

  const empty = await runAuditEmptyRoles({
    ...options,
    domain: options.domain,
    json: true,
    quiet: true,
  });

  // Filter out built-in Sitecore roles unless --include-builtin is set.
  // Empty audit results land here regardless of platform-status —
  // every fresh tenant has dozens of empty built-in roles, and naive
  // purge would shred the role model that Item.AccessRights depends on.
  const userSkip = new Set((options.alwaysSkip ?? []).map((s) => s.toLowerCase()));
  const wasSkipped = (roleName: string): boolean => {
    // Audit returns `name` as either the fully-qualified `domain\\Role`
    // form OR the bare role name — accept both. Compare both the full
    // string and the bare name against --always-skip; pass either form
    // straight to the built-in matcher (it splits internally).
    const lower = roleName.toLowerCase();
    if (userSkip.has(lower)) return true;
    const sep = roleName.indexOf("\\");
    if (sep >= 0) {
      const bare = roleName.slice(sep + 1).toLowerCase();
      if (userSkip.has(bare)) return true;
    }
    if (!options.includeBuiltin && isBuiltinSitecoreRole(roleName)) return true;
    return false;
  };
  const eligible = empty.filter((r) => !wasSkipped(r.name));
  const skippedBuiltinCount = empty.length - eligible.length;
  if (skippedBuiltinCount > 0) {
    logger.verbose(
      `Skipping ${skippedBuiltinCount} built-in or always-skip role${skippedBuiltinCount === 1 ? "" : "s"} (pass --include-builtin to override).`
    );
  }

  const maxDeletions = options.maxDeletions ?? 50;
  const targets = eligible.slice(0, maxDeletions);
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
      skippedBuiltinCount,
      includeBuiltin: Boolean(options.includeBuiltin),
    },
    options,
  });

  return actions;
};
