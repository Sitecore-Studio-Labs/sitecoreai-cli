import type { EnvironmentConfiguration } from "@/config";

/**
 * Whether an environment is "production-tier" for publish gating.
 * Tier 1 (`scai publish item`) uses this to decide between a simple
 * `[y/N]` prompt and the two-step typed-scope-token flow. Tier 2
 * (`scai publish all`) always treats every env as max-risk regardless
 * of this signal.
 *
 * Order of precedence:
 *   1. Explicit `production: true` / `false` in the env config wins.
 *   2. Otherwise, the env name is matched against /prod/i or /^live/i.
 *
 * The heuristic exists so the common-case naming ("prod", "production",
 * "live") doesn't need explicit opt-in. The explicit flag exists to
 * override the heuristic in either direction (`prod-test` that isn't
 * really production; an oddly-named tenant that IS).
 */
const PRODUCTION_NAME_HEURISTICS = [/prod/i, /^live/i];

export const isProductionTier = (env: EnvironmentConfiguration): boolean => {
  if (env.production === false) {
    return false;
  }
  if (env.production === true) {
    return true;
  }
  const name = env.name ?? "";
  return PRODUCTION_NAME_HEURISTICS.some((rx) => rx.test(name));
};
