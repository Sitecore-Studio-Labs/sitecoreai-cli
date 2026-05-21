/**
 * Workspace-policy types — the operator-owned guardrail layer that bounds
 * which Sitecore environments scai may operate against.
 *
 * The file shapes are inferred from the Zod schemas in `./schema` so the
 * validator and the types can never drift; the helpers below
 * (`EffectivePolicy`, the risk-tier ordering) are hand-written because
 * they describe runtime results, not on-disk JSON.
 *
 * See docs/policy-and-guardrails.md for the design.
 */

import type { z } from "zod";
import type {
  envIdentitySchema,
  orgIdentitySchema,
  policyEnvironmentSchema,
  policyOrganizationSchema,
  repoPolicySchema,
  riskTierSchema,
  workspacePolicySchema,
} from "./schema";

/**
 * Operation risk tiers, ascending. Phase 1 records a `ceiling` per
 * environment but enforces only enrollment + identity; `destructive` and
 * `mint` gain enforcement in Phase 2.
 */
export type RiskTier = z.infer<typeof riskTierSchema>;

/** The pinned identity (tenant triple + host) of an enrolled environment. */
export type EnvIdentity = z.infer<typeof envIdentitySchema>;

/** One enrolled environment in the user-global workspace policy. */
export type PolicyEnvironment = z.infer<typeof policyEnvironmentSchema>;

/** The pinned identity of an enrolled organization. */
export type OrgIdentity = z.infer<typeof orgIdentitySchema>;

/** One enrolled organization in the user-global workspace policy. */
export type PolicyOrganization = z.infer<typeof policyOrganizationSchema>;

/** The user-global workspace policy — `~/.sitecoreai/policy.json`. */
export type WorkspacePolicy = z.infer<typeof workspacePolicySchema>;

/** The optional repo policy — `<repo>/scai.policy.json`. */
export type RepoPolicy = z.infer<typeof repoPolicySchema>;

/** How an environment came to be enrolled. */
export type EnrollSource = PolicyEnvironment["enrolledVia"];

/** Risk tiers in ascending order — the array index is the rank. */
export const RISK_TIERS = ["read", "write", "destructive", "mint"] as const;

/** The resolved, layered verdict for a single environment. */
export interface EffectivePolicy {
  /** False when no user-global policy file exists — "unmanaged mode". */
  managed: boolean;
  /** Whether the environment is on the effective (layered) allowlist. */
  enrolled: boolean;
  /** Effective ceiling — the intersection of the user-global and repo layers. */
  ceiling: RiskTier;
  /** Pinned identity, or `null` when the environment is not enrolled. */
  identity: EnvIdentity | null;
  /** Phase 2 — whether `scai setup client create` may mint here (post repo-narrowing). */
  mintCredentials: boolean;
  /** Phase 2 — whether a CI caller may write/destructive here (post repo-narrowing). */
  ciWrites: boolean;
  /** Phase 3 — freshness window (minutes) for destructive/mint ops; `undefined` = no requirement. */
  stepUpMinutes: number | undefined;
}

/** Rank of a tier (`read` = 0, `mint` = 3). */
export const riskRank = (tier: RiskTier): number => RISK_TIERS.indexOf(tier);

/** The lower (more restrictive) of two tiers. */
export const minTier = (a: RiskTier, b: RiskTier): RiskTier => (riskRank(a) <= riskRank(b) ? a : b);
