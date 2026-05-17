/**
 * scai workspace-policy guardrails — the operator-owned layer that bounds
 * which Sitecore environments scai may operate against, deny-by-default.
 *
 * See docs/policy-and-guardrails.md for the design and threat model.
 */

export { enforceEnvironmentPolicy } from "./enforce";
export type { EnforceEnvironmentPolicyParams } from "./enforce";
export { authorizeOperation } from "./authorize";
export type { AuthorizeOperationParams } from "./authorize";
export { resolveCallerContext } from "./caller";
export type { CallerContext, CallerKind } from "./caller";
export {
  enrollEnvironment,
  repinEnvironment,
  setEnvironmentFlags,
  unenrollEnvironment,
} from "./enroll";
export type { EnrollEnvironmentParams, EnrollResult, EnvironmentFlags } from "./enroll";
export { resolveEffectivePolicy } from "./resolve";
export { isManaged, readRepoPolicy, readWorkspacePolicy, writeWorkspacePolicy } from "./store";
export { describeIdentityDrift, extractIdentity, identityMatchesPin } from "./identity";
export { resolvePolicyDir, resolveRepoPolicyPath, resolveUserPolicyPath } from "./paths";
export { RISK_TIERS, minTier, riskRank } from "./types";
export type {
  EffectivePolicy,
  EnrollSource,
  EnvIdentity,
  PolicyEnvironment,
  RepoPolicy,
  RiskTier,
  WorkspacePolicy,
} from "./types";
