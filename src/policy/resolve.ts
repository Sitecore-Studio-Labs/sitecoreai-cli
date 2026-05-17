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
 * repo policy (`scai.policy.json`), if any, sits beside it. It is
 * optional — when omitted, the repo-policy narrowing layer is skipped
 * and only the user-global policy applies.
 */
export const resolveEffectivePolicy = (
  envName: string,
  configRootDir?: string
): EffectivePolicy => {
  const workspace = readWorkspacePolicy();
  if (!workspace) {
    // Unmanaged mode — no user-global policy file exists.
    return {
      managed: false,
      enrolled: false,
      ceiling: "read",
      identity: null,
      mintCredentials: false,
      ciWrites: false,
      stepUpMinutes: undefined,
    };
  }

  const wsEnv = workspace.environments[envName];
  if (!wsEnv) {
    return {
      managed: true,
      enrolled: false,
      ceiling: "read",
      identity: null,
      mintCredentials: false,
      ciWrites: false,
      stepUpMinutes: undefined,
    };
  }

  // The repo policy can only narrow: drop the environment from the
  // allowlist, lower its ceiling, or flip a flag false.
  const repo = configRootDir ? readRepoPolicy(configRootDir) : null;
  const allowedByRepo = !repo?.allowEnvironments || repo.allowEnvironments.includes(envName);
  const repoEnv = repo?.environments?.[envName];

  let ceiling: RiskTier = wsEnv.ceiling;
  if (repoEnv?.ceiling) {
    ceiling = minTier(ceiling, repoEnv.ceiling);
  }

  // Step-up window — a repo policy may only shorten it, never lengthen.
  const stepUpCandidates = [wsEnv.stepUpMinutes, repoEnv?.stepUpMinutes].filter(
    (value): value is number => typeof value === "number"
  );
  const stepUpMinutes = stepUpCandidates.length > 0 ? Math.min(...stepUpCandidates) : undefined;

  return {
    managed: true,
    enrolled: allowedByRepo,
    ceiling,
    identity: wsEnv.identity,
    mintCredentials: wsEnv.mintCredentials === true && repoEnv?.mintCredentials !== false,
    ciWrites: wsEnv.ciWrites === true && repoEnv?.ciWrites !== false,
    stepUpMinutes,
  };
};
