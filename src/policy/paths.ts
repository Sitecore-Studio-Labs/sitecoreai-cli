/**
 * Filesystem locations for the policy artifacts.
 *
 * The user-global policy joins the established `~/.sitecoreai/` directory
 * (alongside `audit.log`, `rollback/`). The repo policy sits next to the
 * `sitecoreai.cli.json` it narrows.
 */

import os from "node:os";
import path from "node:path";

const POLICY_FILE = "policy.json";
const REPO_POLICY_FILE = "scai.policy.json";

/**
 * The directory holding the user-global workspace policy.
 *
 * Honors `SITECOREAI_POLICY_HOME` so tests run against a temp directory.
 * Under Vitest with no override it returns `null` — the real
 * `~/.sitecoreai/policy.json` can never leak into a test run, and a
 * `null` directory means "unmanaged mode" everywhere downstream, so the
 * existing test suite (which has no policy file) is unaffected.
 */
export const resolvePolicyDir = (): string | null => {
  const override = process.env.SITECOREAI_POLICY_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (process.env.VITEST) {
    return null;
  }
  return path.join(os.homedir(), ".sitecoreai");
};

/** Absolute path to the user-global workspace policy, or `null` (see above). */
export const resolveUserPolicyPath = (): string | null => {
  const dir = resolvePolicyDir();
  return dir ? path.join(dir, POLICY_FILE) : null;
};

/** Path to the optional repo policy, next to the resolved config file. */
export const resolveRepoPolicyPath = (configRootDir: string): string =>
  path.join(configRootDir, REPO_POLICY_FILE);
