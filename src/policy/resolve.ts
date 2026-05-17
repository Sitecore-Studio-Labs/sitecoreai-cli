/**
 * Layered policy resolution. Each layer may only NARROW the one above it,
 * so the effective verdict is the intersection of the user-global policy
 * and the optional repo policy — never the union.
 */

import { readRepoPolicy, readWorkspacePolicy } from "./store";
import { minTier, type EffectivePolicy, type RiskTier } from "./types";

/**
 * Compute the effective policy for one environment.
 *
 * `configRootDir` is the directory holding `sitecoreai.cli.json`; the
 * repo policy (`scai.policy.json`), if any, sits beside it.
 */
export const resolveEffectivePolicy = (envName: string, configRootDir: string): EffectivePolicy => {
  const workspace = readWorkspacePolicy();
  if (!workspace) {
    // Unmanaged mode — no user-global policy file exists.
    return { managed: false, enrolled: false, ceiling: "read", identity: null };
  }

  const wsEnv = workspace.environments[envName];
  if (!wsEnv) {
    return { managed: true, enrolled: false, ceiling: "read", identity: null };
  }

  // The repo policy can only narrow: drop the environment from the
  // allowlist, or lower its ceiling.
  const repo = readRepoPolicy(configRootDir);
  const allowedByRepo = !repo?.allowEnvironments || repo.allowEnvironments.includes(envName);

  let ceiling: RiskTier = wsEnv.ceiling;
  const repoCeiling = repo?.environments?.[envName]?.ceiling;
  if (repoCeiling) {
    ceiling = minTier(ceiling, repoCeiling);
  }

  return {
    managed: true,
    enrolled: allowedByRepo,
    ceiling,
    identity: wsEnv.identity,
  };
};
