/**
 * Organization-scoped workspace-policy gate — the parallel of
 * `enforceEnvironmentPolicy` for `brand`, `brief`, and `campaign`.
 *
 * Background: the workspace policy was originally environment-scoped
 * because every guarded path acted on an XM Cloud environment. The org-
 * scoped product surface (brand kits, briefs, campaigns, documents,
 * pipeline, review) is keyed by Sitecore organization, not environment,
 * so `enforceEnvironmentPolicy` doesn't bind it — `resolveOrganization`
 * historically returned the orgId with no allowlist check. That meant a
 * caller with an enrolled `brand[orgId]` credential could retarget any
 * orgId at will. Closed 2026-05-21.
 *
 * Two modes:
 *
 *   - Strict (`workspacePolicy.strictOrgs: true`) — the orgId MUST be
 *     in `workspacePolicy.organizations`. Mirrors env-scoped enrollment.
 *   - Lenient (default) — the orgId is considered enrolled if either
 *     (a) it's in `workspacePolicy.organizations`, or (b) any enrolled
 *     env profile carries the same `organizationId`. Lets existing
 *     policy files keep working without a manual migration: env
 *     enrollment transitively enrolls its org.
 *
 * The repo policy (`scai.policy.json`) may narrow but not widen — same
 * shape as the env layer: `allowOrganizations` is an intersect, and
 * `organizations[orgId].ceiling` may only lower the user-global ceiling.
 */

import type { OrgIdentity, RiskTier } from "./types";
import { minTier } from "./types";
import { readRepoPolicy, readWorkspacePolicy } from "./store";
import { createScaiError } from "@/shared/errors";

/** The resolved org-policy verdict. Mirrors `EffectivePolicy` for envs. */
export interface EffectiveOrganizationPolicy {
  /** False when no user-global policy file exists — "unmanaged mode". */
  managed: boolean;
  /** Whether the org is on the effective (layered) allowlist. */
  enrolled: boolean;
  /** Effective ceiling — the intersection of user-global and repo layers. */
  ceiling: RiskTier;
  /** Pinned identity, or `null` when the org is not enrolled. */
  identity: OrgIdentity | null;
  /** Phase 2 — whether `setup client register-brand` may mint here. */
  mintCredentials: boolean;
  /** Phase 2 — whether a CI caller may write/destructive here. */
  ciWrites: boolean;
  /** Phase 3 — freshness window (minutes) for destructive/mint ops. */
  stepUpMinutes: number | undefined;
  /**
   * How enrollment was satisfied: an explicit `organizations[orgId]`
   * entry (`"explicit"`), or the lenient fall-through where an enrolled
   * env profile carrying this orgId implies enrollment (`"transitive"`).
   * `null` when not enrolled. Surfaced by `scai access check` so the
   * operator can see whether to add an explicit entry before flipping
   * `strictOrgs: true`.
   */
  enrolledVia: "explicit" | "transitive" | null;
}

const UNMANAGED: EffectiveOrganizationPolicy = {
  managed: false,
  enrolled: false,
  ceiling: "read",
  identity: null,
  mintCredentials: false,
  ciWrites: false,
  stepUpMinutes: undefined,
  enrolledVia: null,
};

/** Compute the effective org-policy verdict. Sync, mirrors `resolveEffectivePolicy`. */
export const resolveEffectiveOrganizationPolicy = (
  orgId: string,
  configRootDir?: string
): EffectiveOrganizationPolicy => {
  const workspace = readWorkspacePolicy();
  if (!workspace) {
    return UNMANAGED;
  }

  const explicit = workspace.organizations?.[orgId];
  const repo = configRootDir ? readRepoPolicy(configRootDir) : null;

  // Strict mode demands an explicit entry. Repo `allowOrganizations`
  // may narrow further.
  if (workspace.strictOrgs) {
    if (!explicit) {
      return { ...UNMANAGED, managed: true };
    }
    const allowedByRepo = !repo?.allowOrganizations || repo.allowOrganizations.includes(orgId);
    if (!allowedByRepo) {
      return { ...UNMANAGED, managed: true };
    }
    const repoEntry = repo?.organizations?.[orgId];
    return {
      managed: true,
      enrolled: true,
      ceiling: repoEntry?.ceiling ? minTier(explicit.ceiling, repoEntry.ceiling) : explicit.ceiling,
      identity: explicit.identity,
      mintCredentials: explicit.mintCredentials === true && repoEntry?.mintCredentials !== false,
      ciWrites: explicit.ciWrites === true && repoEntry?.ciWrites !== false,
      stepUpMinutes: minDefined(explicit.stepUpMinutes, repoEntry?.stepUpMinutes),
      enrolledVia: "explicit",
    };
  }

  // Lenient mode. Explicit wins over transitive — only fall through when
  // there is no `organizations[orgId]` entry.
  if (explicit) {
    const repoEntry = repo?.organizations?.[orgId];
    const allowedByRepo = !repo?.allowOrganizations || repo.allowOrganizations.includes(orgId);
    if (!allowedByRepo) {
      return { ...UNMANAGED, managed: true };
    }
    return {
      managed: true,
      enrolled: true,
      ceiling: repoEntry?.ceiling ? minTier(explicit.ceiling, repoEntry.ceiling) : explicit.ceiling,
      identity: explicit.identity,
      mintCredentials: explicit.mintCredentials === true && repoEntry?.mintCredentials !== false,
      ciWrites: explicit.ciWrites === true && repoEntry?.ciWrites !== false,
      stepUpMinutes: minDefined(explicit.stepUpMinutes, repoEntry?.stepUpMinutes),
      enrolledVia: "explicit",
    };
  }

  // Transitive: any enrolled env profile carrying this orgId implies the
  // org is enrolled at that env's ceiling. When multiple envs reference
  // the same org, take the LOOSEST ceiling — the env-scoped gate already
  // enforces its own per-env ceiling on the env-scoped path, so the
  // org-scoped gate should not be stricter than the env-scoped one.
  let transitive: { ceiling: RiskTier; identity: OrgIdentity } | undefined;
  for (const [, envEntry] of Object.entries(workspace.environments)) {
    if (envEntry.identity?.organizationId !== orgId) continue;
    if (!transitive) {
      transitive = {
        ceiling: envEntry.ceiling,
        identity: { organizationId: orgId },
      };
      continue;
    }
    // looser ceiling wins (max rank)
    if (minTier(transitive.ceiling, envEntry.ceiling) === transitive.ceiling) {
      transitive = {
        ceiling: envEntry.ceiling,
        identity: { organizationId: orgId },
      };
    }
  }
  if (!transitive) {
    return { ...UNMANAGED, managed: true };
  }
  return {
    managed: true,
    enrolled: true,
    ceiling: transitive.ceiling,
    identity: transitive.identity,
    mintCredentials: false,
    ciWrites: false,
    stepUpMinutes: undefined,
    enrolledVia: "transitive",
  };
};

const minDefined = (a: number | undefined, b: number | undefined): number | undefined => {
  const xs = [a, b].filter((x): x is number => typeof x === "number");
  return xs.length > 0 ? Math.min(...xs) : undefined;
};

export interface EnforceOrganizationPolicyParams {
  orgId: string;
  /** Directory holding `sitecoreai.cli.json`; enables repo-policy narrowing. */
  configRootDir?: string;
}

/**
 * Throws `POLICY_DENIED` when the organization is not on the workspace-
 * policy allowlist. A no-op in unmanaged mode.
 *
 * Called from `resolveOrganization` so every CLI / SDK / MCP surface
 * routes through it.
 */
export const enforceOrganizationPolicy = (params: EnforceOrganizationPolicyParams): void => {
  const { orgId, configRootDir } = params;
  const effective = resolveEffectiveOrganizationPolicy(orgId, configRootDir);
  if (!effective.managed) {
    return;
  }
  if (!effective.enrolled) {
    throw createScaiError(
      `Organization '${orgId}' is not in the scai workspace policy allowlist.`,
      "POLICY_DENIED",
      {
        hint:
          `Enroll it with 'scai policy allow-org ${orgId}', or enroll an env profile that carries this organizationId. ` +
          `Run 'scai policy show' to see what is allowed.`,
        remediation: {
          actor: "agent",
          fix: `scai policy allow-org ${orgId}`,
          detail: "Enrolls the organization in the workspace-policy allowlist.",
        },
      }
    );
  }
};
