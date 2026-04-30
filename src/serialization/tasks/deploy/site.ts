/**
 * `scai deploy site list` runner.
 *
 * Discovers SXA sites in a Sitecore CM environment via the Authoring
 * GraphQL API. Sibling of `editing-host list`, but where editing hosts
 * come from the Deploy API, sites come from inside the CM's content
 * tree — so this command resolves env config the same way `scai
 * recipe push` does (via `resolveTenant`-style lookup) rather than
 * `getDeployContext`. Both flows authenticate against the same
 * env profile written by `scai login`.
 */

import {
  type EnvironmentConfiguration,
  readRootConfiguration,
  readRootConfigurationFile,
} from "@/config";
import { discoverSites } from "@/recipe/api/site-discovery";
import { resolveApiTimeoutMs } from "@/serialization/tasks/shared";
import { createCliError } from "@/shared/errors";
import { printDeployResultWithContext, toLogger } from "../shared";
import type { DeploySiteListOptions } from "../types";

const resolveAuthoringEnvironment = (
  options: DeploySiteListOptions
): { envName: string; environment: EnvironmentConfiguration; timeoutMs?: number } => {
  const configPath = options.config ?? process.cwd();
  const rootFile = readRootConfigurationFile(configPath);
  const envName = options.environmentName ?? rootFile.config.defaultEnvProfile;
  if (!envName) {
    throw createCliError("Environment name is required.", "INPUT_INVALID", {
      hint: "Pass --environment-name or set defaultEnvProfile in the config.",
    });
  }
  const root = readRootConfiguration(configPath, envName);
  const environment = root.environments[envName];
  if (!environment) {
    throw createCliError(`Environment '${envName}' is not configured.`, "ENV_NOT_FOUND", {
      hint: "Run 'scai init' to configure the environment.",
    });
  }
  return { envName, environment, timeoutMs: resolveApiTimeoutMs(root) };
};

export const runDeploySiteList = async (options: DeploySiteListOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName, environment } = resolveAuthoringEnvironment(options);

  const sites = await discoverSites(environment, {
    includeHostnames: Boolean(options.hostnames),
    contentRoot: options.contentRoot,
  });

  printDeployResultWithContext(
    logger,
    { envName },
    "deploy.site.list",
    sites,
    { count: sites.length }
  );
};
