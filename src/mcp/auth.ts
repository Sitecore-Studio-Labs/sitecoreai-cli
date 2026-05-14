/**
 * Resolves the environment binding for `scai mcp serve` once at startup
 * and packages everything tool handlers need into a single `McpContext`.
 *
 * One server instance, one env. Multi-env = multiple processes.
 *
 * The deploy access token is fetched from the OS keychain (or the
 * `deployToken` field of the env's config block as fallback). The
 * Authoring API access token is acquired lazily on first use — recipe
 * and serialization tools handle their own OAuth flow because the
 * authoring credentials may differ from the deploy credentials.
 */

import { resolveEnvironment, type ResolvedEnvironment } from "@/shared/env";
import { getDeployToken } from "@/shared/keychain";
import { createScaiError } from "@/shared/errors";

export interface McpContext {
  envName: string;
  configPath: string;
  resolved: ResolvedEnvironment;
  allowWriteEnabled: boolean;
  /** Cached deploy access token (resolved at bind-time). */
  deployToken: string;
}

export interface BindMcpEnvironmentOptions {
  configPath?: string;
  environmentName?: string;
}

export const bindMcpEnvironment = async (
  options: BindMcpEnvironmentOptions
): Promise<McpContext> => {
  const resolved = resolveEnvironment({
    config: options.configPath,
    environmentName: options.environmentName,
  });

  const deployToken = (await getDeployToken(resolved.envName)) ?? resolved.environment.deployToken;
  if (!deployToken) {
    throw createScaiError(
      `Deploy token not found for environment '${resolved.envName}'.`,
      "AUTH_REQUIRED",
      {
        hint: "Run `scai login` for this environment in a separate terminal, then restart `scai mcp serve`.",
      }
    );
  }

  return {
    envName: resolved.envName,
    configPath: options.configPath ?? process.cwd(),
    resolved,
    allowWriteEnabled: resolved.environment.allowWrite === true,
    deployToken,
  };
};
