/**
 * `scai provision deploy site list` runner.
 *
 * Discovers SXA sites in a Sitecore CM environment via the Authoring
 * GraphQL API. Sibling of `editing-host list`, but where editing hosts
 * come from the Deploy API, sites come from inside the CM's content
 * tree — so this command resolves env config the same way `scai
 * recipe push` does (via `resolveTenant`-style lookup) rather than
 * `getDeployContext`. Both flows authenticate against the same
 * env profile written by `scai setup login`.
 */

import { discoverSites } from "@/recipe/api/site-discovery";
import { resolveEnvironment } from "@/policy/environment";
import { printDeployResultWithContext, toLogger } from "./shared";
import type { DeploySiteListOptions } from "./types";

export const runDeploySiteList = async (options: DeploySiteListOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName, environment } = resolveEnvironment(options);

  const sites = await discoverSites(environment, {
    includeHostnames: Boolean(options.hostnames),
    contentRoot: options.contentRoot,
  });

  printDeployResultWithContext(logger, { envName }, "deploy.site.list", sites, {
    count: sites.length,
  });
};
