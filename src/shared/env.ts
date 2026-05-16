/**
 * Shared environment-resolution helper. Replaces the three near-duplicate
 * implementations that grew up across `recipe/tasks/shared.ts:resolveTenant`,
 * `deploy/tasks/shared.ts:getDeployContext`, and the hand-copied
 * `resolveAuthoringEnvironment` blocks in `deploy/tasks/site.ts` and
 * `deploy/tasks/site-bind.ts` — all doing the same
 * readRoot → defaultEnvProfile → environment-or-throw dance with slightly
 * different error messages and return shapes.
 *
 * Domain-specific wrappers (recipe `resolveTenant`, deploy
 * `getDeployContext`) compose this and add their own decoration
 * (auth client, deploy token lookup, etc.).
 */

import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";
import { readRootConfiguration, readRootConfigurationFile } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import { resolveApiTimeoutMs } from "./cli-tasks";

export interface ResolvedEnvironment {
  envName: string;
  environment: EnvironmentConfiguration;
  root: RootConfiguration;
  /** Tenant API client timeout in ms, derived from
   *  `settings.apiClientTimeoutInMinutes`. `undefined` when unset/invalid. */
  timeoutMs: number | undefined;
}

export interface ResolveEnvironmentOptions {
  config?: string;
  environmentName?: string;
}

export const resolveEnvironment = (options: ResolveEnvironmentOptions): ResolvedEnvironment => {
  const configPath = options.config ?? process.cwd();
  const rootFile = readRootConfigurationFile(configPath);
  const envName = options.environmentName ?? rootFile.config.defaultEnvProfile;
  if (!envName) {
    throw createScaiError("Environment name is required.", "INPUT_INVALID", {
      hint: "Pass --environment-name or set defaultEnvProfile in the config.",
    });
  }
  const root = readRootConfiguration(configPath, envName);
  const environment = root.environments[envName];
  if (!environment) {
    throw createScaiError(`Environment '${envName}' is not configured.`, "ENV_NOT_FOUND", {
      hint: "Run 'scai setup init' to configure the environment.",
    });
  }
  return { envName, environment, root, timeoutMs: resolveApiTimeoutMs(root) };
};
