/**
 * Auto-populate the workspace policy. The operator never hand-edits
 * `policy.json`; it is created and maintained here, from `scai setup
 * login`, `scai mcp serve`, and the `scai policy` commands.
 */

import type { EnvironmentConfiguration } from "@/config/types";
import { extractIdentity } from "./identity";
import { readWorkspacePolicy, writeWorkspacePolicy } from "./store";
import type { EnrollSource, PolicyEnvironment, RiskTier, WorkspacePolicy } from "./types";

export interface EnrollEnvironmentParams {
  envName: string;
  environment: EnvironmentConfiguration;
  via: EnrollSource;
  /** Ceiling for a newly-enrolled environment. Defaults to `write`. */
  ceiling?: RiskTier;
}

export interface EnrollResult {
  /** True when this call created the policy file (first-ever enrollment). */
  created: boolean;
  /** True when the environment was already enrolled before this call. */
  alreadyEnrolled: boolean;
  /** False when no policy directory is resolvable, so nothing was written. */
  written: boolean;
}

/**
 * Idempotently enroll an environment into the user-global workspace
 * policy. Creates the policy file on first use. Re-enrolling an existing
 * environment refreshes its pinned identity and `enrolledAt` but keeps
 * its original ceiling and `enrolledVia` — re-running login must not
 * silently widen a ceiling the operator narrowed.
 *
 * Never throws on a missing policy directory (Vitest without
 * `SITECOREAI_POLICY_HOME`) — it returns `written: false` instead, so
 * callers in the login / serve paths stay simple.
 */
export const enrollEnvironment = (params: EnrollEnvironmentParams): EnrollResult => {
  const existing = readWorkspacePolicy();
  const policy: WorkspacePolicy = existing ?? { version: 1, environments: {} };
  const prior = policy.environments[params.envName];

  const entry: PolicyEnvironment = {
    identity: extractIdentity(params.environment),
    ceiling: prior?.ceiling ?? params.ceiling ?? "write",
    enrolledAt: new Date().toISOString(),
    enrolledVia: prior?.enrolledVia ?? params.via,
    // `setup login` is the operator interactively choosing this env, so a
    // new login enrollment is mint-eligible; every other path is not. A
    // prior value always wins — re-login never re-widens what an operator
    // narrowed via `scai policy set`.
    mintCredentials: prior?.mintCredentials ?? params.via === "setup-login",
    ciWrites: prior?.ciWrites ?? false,
  };
  policy.environments[params.envName] = entry;

  const writtenPath = writeWorkspacePolicy(policy);
  return {
    created: existing === null && writtenPath !== null,
    alreadyEnrolled: prior !== undefined,
    written: writtenPath !== null,
  };
};

/**
 * Re-pin an already-enrolled environment's identity to whatever the
 * config currently says — the `scai policy trust` path, used after a
 * legitimate tenant change. Returns `false` if the environment is not
 * enrolled or nothing could be written.
 */
export const repinEnvironment = (
  envName: string,
  environment: EnvironmentConfiguration
): boolean => {
  const policy = readWorkspacePolicy();
  const prior = policy?.environments[envName];
  if (!policy || !prior) {
    return false;
  }
  policy.environments[envName] = { ...prior, identity: extractIdentity(environment) };
  return writeWorkspacePolicy(policy) !== null;
};

/** Remove an environment from the allowlist. Returns `false` if absent. */
export const unenrollEnvironment = (envName: string): boolean => {
  const policy = readWorkspacePolicy();
  if (!policy || !policy.environments[envName]) {
    return false;
  }
  delete policy.environments[envName];
  return writeWorkspacePolicy(policy) !== null;
};

/** Phase 2 policy flags an operator may tune on an enrolled environment. */
export interface EnvironmentFlags {
  ceiling?: RiskTier;
  mintCredentials?: boolean;
  ciWrites?: boolean;
}

/**
 * Explicitly update an enrolled environment's Phase 2 policy flags — the
 * `scai policy set` path. Only the fields provided are changed. Returns
 * `false` if the environment is not enrolled or nothing could be written.
 */
export const setEnvironmentFlags = (envName: string, flags: EnvironmentFlags): boolean => {
  const policy = readWorkspacePolicy();
  const prior = policy?.environments[envName];
  if (!policy || !prior) {
    return false;
  }
  policy.environments[envName] = {
    ...prior,
    ceiling: flags.ceiling ?? prior.ceiling,
    mintCredentials: flags.mintCredentials ?? prior.mintCredentials,
    ciWrites: flags.ciWrites ?? prior.ciWrites,
  };
  return writeWorkspacePolicy(policy) !== null;
};
