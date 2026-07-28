/**
 * `runEnvironmentOnboard` — stand up a new environment profile.
 *
 * The agent-drivable half of environment setup: write the env profile
 * into `sitecoreai.cli.json`, then run the access preflight so the
 * caller sees exactly what is left — policy enrollment (agent-clearable)
 * and credentials (human-terminal-only, see `HUMAN_ONLY_OPERATIONS`).
 *
 * It deliberately does NOT mint a client or log in — those are
 * human-only — and does NOT discover the tenant: the caller supplies
 * the organization / project / environment ids and host (resolve them
 * first with the deploy tools or `scai_overview`).
 */

import { readRootConfigurationFile, writeRootConfigurationFile } from "@/config/root-config";
import type { EnvironmentConfiguration } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { assertValidHost } from "@/shared/validate";
import { checkAccess, type AccessReport } from "@/policy/access-check";

const DEFAULT_AUTHORITY = "https://auth.sitecorecloud.io";

export interface EnvironmentOnboardOptions {
  /** Directory holding `sitecoreai.cli.json`, or a path to it. */
  config?: string;
  /** Local profile name for the new environment. */
  environmentName: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  /** CM host, e.g. `xmc-org-env.sitecorecloud.io`. */
  host: string;
  environmentType?: "cm" | "eh";
  authority?: string;
}

export interface EnvironmentOnboardResult {
  environmentName: string;
  /** The profile written to the config. */
  profile: EnvironmentConfiguration;
  /** Access preflight for the freshly-written environment — the steps that remain. */
  access: AccessReport;
}

/**
 * Add a new environment profile to the config, then preflight it.
 * Throws `INPUT_INVALID` rather than clobbering an existing profile.
 */
export const runEnvironmentOnboard = async (
  options: EnvironmentOnboardOptions
): Promise<EnvironmentOnboardResult> => {
  const configPath = options.config ?? process.cwd();
  const envName = options.environmentName.trim();
  if (!envName) {
    throw createScaiError("An environment name is required.", "INPUT_INVALID");
  }
  assertValidHost(options.host, "CM host");

  const rootFile = readRootConfigurationFile(configPath);
  const envProfiles = rootFile.config.envProfiles ?? {};
  if (envProfiles[envName]) {
    throw createScaiError(`Environment '${envName}' is already configured.`, "INPUT_INVALID", {
      hint: "Pick a different name, or edit the existing profile directly.",
    });
  }

  const profile: EnvironmentConfiguration = {
    organizationId: options.organizationId,
    projectId: options.projectId,
    environmentId: options.environmentId,
    environmentType: options.environmentType ?? "cm",
    host: options.host,
    authority: options.authority ?? DEFAULT_AUTHORITY,
  };
  rootFile.config.envProfiles = { ...envProfiles, [envName]: profile };
  writeRootConfigurationFile(configPath, rootFile.config);

  const access = await checkAccess({ configPath, environmentName: envName });
  return { environmentName: envName, profile, access };
};
