/**
 * The deny-by-default environment gate.
 *
 * Called from inside `resolveEnvironment` (`src/shared/env.ts`) — the one
 * resolver every surface (CLI, SDK, MCP) routes through — so no call site
 * can miss it.
 */

import type { EnvironmentConfiguration } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { describeIdentityDrift, extractIdentity } from "./identity";
import { resolveEffectivePolicy } from "./resolve";

export interface EnforceEnvironmentPolicyParams {
  envName: string;
  environment: EnvironmentConfiguration;
  /** Directory holding the resolved `sitecoreai.cli.json`. */
  configRootDir: string;
}

/**
 * Throws `POLICY_DENIED` when the environment is not on the workspace-
 * policy allowlist, or when its tenant identity has drifted from what was
 * pinned at enrollment.
 *
 * A no-op in "unmanaged mode" (no `~/.sitecoreai/policy.json`), so a
 * setup that predates this feature is never locked out — the policy file
 * appears, and enforcement switches on, the next time the operator runs
 * `scai setup login`, `scai mcp serve`, or `scai policy init`.
 */
export const enforceEnvironmentPolicy = (params: EnforceEnvironmentPolicyParams): void => {
  const { envName, environment, configRootDir } = params;
  const effective = resolveEffectivePolicy(envName, configRootDir);

  if (!effective.managed) {
    return;
  }

  if (!effective.enrolled) {
    throw createScaiError(
      `Environment '${envName}' is not in the scai workspace policy allowlist.`,
      "POLICY_DENIED",
      {
        hint:
          `Enroll it with 'scai policy allow ${envName}', or run ` +
          `'scai policy show' to see which environments are allowed.`,
      }
    );
  }

  if (effective.identity) {
    const drift = describeIdentityDrift(effective.identity, extractIdentity(environment));
    if (drift.length > 0) {
      throw createScaiError(
        `Environment '${envName}' identity has changed since it was enrolled in the workspace policy.`,
        "POLICY_DENIED",
        {
          details: drift,
          hint:
            `If this change is expected, re-pin it with 'scai policy trust ${envName}'. ` +
            `If not, your sitecoreai.cli.json may have been tampered with.`,
        }
      );
    }
  }
};
