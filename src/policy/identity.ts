/**
 * Environment identity extraction and drift detection — the Phase 1
 * trust-on-first-use mechanism. The allowlist catches *new* environments;
 * the identity pin catches an enrolled environment name whose tenant
 * triple has been *swapped* underneath it.
 */

import type { EnvironmentConfiguration } from "@/config/types";
import type { EnvIdentity } from "./types";

/** The identity-pin fields, in display order. */
const IDENTITY_FIELDS: ReadonlyArray<keyof EnvIdentity> = [
  "organizationId",
  "projectId",
  "environmentId",
  "host",
];

/**
 * Extract the pinnable identity (tenant triple + host) from an env
 * profile. Fields the profile doesn't carry are omitted, so the pin only
 * ever asserts what was actually known at enrollment time.
 */
export const extractIdentity = (env: EnvironmentConfiguration): EnvIdentity => {
  const identity: EnvIdentity = {};
  if (env.organizationId) identity.organizationId = env.organizationId;
  if (env.projectId) identity.projectId = env.projectId;
  if (env.environmentId) identity.environmentId = env.environmentId;
  if (env.host) identity.host = env.host;
  return identity;
};

/**
 * Compare a current identity against a pinned one. Only fields present in
 * the PIN are checked — the pin is the contract. A pinned field that is
 * missing or different in `current` counts as drift. Returns a list of
 * human-readable drift descriptions; an empty list means the identity
 * still matches.
 */
export const describeIdentityDrift = (pinned: EnvIdentity, current: EnvIdentity): string[] => {
  const drift: string[] = [];
  for (const field of IDENTITY_FIELDS) {
    const pin = pinned[field];
    if (pin === undefined) {
      continue;
    }
    if (current[field] !== pin) {
      drift.push(`${field}: pinned '${pin}', config now has '${current[field] ?? "(unset)"}'`);
    }
  }
  return drift;
};

/** Whether `current` still matches everything the `pinned` identity asserts. */
export const identityMatchesPin = (pinned: EnvIdentity, current: EnvIdentity): boolean =>
  describeIdentityDrift(pinned, current).length === 0;
