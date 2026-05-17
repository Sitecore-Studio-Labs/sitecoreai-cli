/**
 * Tier-aware operation gate — Phase 2 of the workspace policy.
 *
 * `enforceEnvironmentPolicy` (Phase 1) answers "may scai touch this
 * environment at all". `authorizeOperation` answers the Phase 2
 * question: "may *this caller* perform a *write* / *destructive* /
 * *mint* operation here". See docs/policy-and-guardrails.md.
 */

import { createScaiError } from "@/shared/errors";
import { resolveCallerContext, type CallerContext } from "./caller";
import { resolveEffectivePolicy } from "./resolve";
import { riskRank, type RiskTier } from "./types";

export interface AuthorizeOperationParams {
  envName: string;
  /**
   * Directory holding the resolved `sitecoreai.cli.json`. Optional —
   * when absent, the repo-policy narrowing layer is skipped (the
   * user-global policy still applies).
   */
  configRootDir?: string;
  /** Risk tier of the operation being attempted. */
  tier: RiskTier;
  /** Override the detected caller context — for tests. */
  caller?: CallerContext;
}

/**
 * Throws `POLICY_DENIED` when the workspace policy does not permit the
 * current caller to run a `tier` operation against `envName`. A no-op
 * for the `read` tier and in unmanaged mode (no `~/.sitecoreai/policy.json`).
 */
export const authorizeOperation = (params: AuthorizeOperationParams): void => {
  const { envName, configRootDir, tier } = params;
  if (tier === "read") {
    return;
  }

  const effective = resolveEffectivePolicy(envName, configRootDir);
  if (!effective.managed) {
    return;
  }
  if (!effective.enrolled) {
    // Phase 1's enforceEnvironmentPolicy already denies a non-enrolled
    // environment before this point; this is a defensive backstop.
    throw createScaiError(
      `Environment '${envName}' is not in the scai workspace policy allowlist.`,
      "POLICY_DENIED",
      { hint: `Enroll it with 'scai policy allow ${envName}'.` }
    );
  }

  const caller = params.caller ?? resolveCallerContext();

  if (tier === "mint") {
    if (!effective.mintCredentials) {
      throw createScaiError(
        `The workspace policy does not permit minting automation clients for '${envName}'.`,
        "POLICY_DENIED",
        { hint: `An operator can enable it with 'scai policy set ${envName} --mint on'.` }
      );
    }
    if (caller.kind !== "interactive-human") {
      throw createScaiError(
        `Minting an automation client for '${envName}' requires an interactive human operator — the caller is '${caller.kind}'.`,
        "POLICY_DENIED",
        {
          hint: "Run 'scai setup client create' yourself in a terminal. Agents, CI, and unattended processes cannot mint credentials.",
        }
      );
    }
    return;
  }

  // write / destructive — ceiling check first.
  if (riskRank(tier) > riskRank(effective.ceiling)) {
    throw createScaiError(
      `Environment '${envName}' is capped at the '${effective.ceiling}' tier by the workspace policy; a '${tier}' operation is not allowed.`,
      "POLICY_DENIED",
      {
        hint: `An operator can raise the ceiling with 'scai policy set ${envName} --ceiling ${tier}'.`,
      }
    );
  }

  if (caller.kind === "ci" && !effective.ciWrites) {
    throw createScaiError(
      `CI '${tier}' operations on '${envName}' are not enabled in the workspace policy.`,
      "POLICY_DENIED",
      { hint: `An operator can enable them with 'scai policy set ${envName} --ci-writes on'.` }
    );
  }

  if (tier === "destructive" && (caller.kind === "m2m" || caller.kind === "mcp")) {
    throw createScaiError(
      `A '${caller.kind}' caller cannot run destructive operations on '${envName}'.`,
      "POLICY_DENIED",
      {
        hint: "Destructive operations require an interactive human operator, or a CI pipeline with ci-writes enabled.",
      }
    );
  }
};
