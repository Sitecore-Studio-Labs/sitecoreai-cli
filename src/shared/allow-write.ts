import type { RootConfiguration } from "@/config";
import { createScaiError } from "./errors";

/**
 * Per-environment write gate. Throws `INPUT_INVALID` unless the
 * environment is configured to allow writes (via `allowWrite` in
 * `sitecoreai.cli.json`, an `SITECOREAI_ENV_<NAME>_ALLOW_WRITE=true`
 * env var, or the per-invocation `override` boolean — typically the
 * caller's `--allow-write` flag).
 *
 * Used by hygiene cleanups, workflow mutations, and any other
 * caller-of-record for tenant-side writes. Same gate, one source of
 * truth — see `feedback_destructive_ops_need_consent` for the broader
 * consent model these commands sit inside.
 */
export const ensureAllowWrite = (
  root: RootConfiguration,
  envName: string,
  override?: boolean
): void => {
  const env = root.environments[envName];
  if (override || env?.allowWrite) return;
  const envKey = envName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  throw createScaiError(
    `Environment ${envName} is not configured to allow writing data.`,
    "INPUT_INVALID",
    {
      hint: `Set allowWrite in sitecoreai.cli.json, set SITECOREAI_ENV_${envKey}_ALLOW_WRITE=true, or pass --allow-write.`,
    }
  );
};
