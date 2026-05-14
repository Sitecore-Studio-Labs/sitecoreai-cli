/**
 * Resolves the environment binding for `scai mcp serve` and packages
 * everything tool handlers need into a single `McpContext`.
 *
 * One server instance, one env. Multi-env = multiple processes.
 *
 * Two-phase resolution so the stdio transport can answer the MCP
 * `initialize` handshake before any keychain access happens:
 *
 *   1. `resolveMcpEnv` — synchronous, reads the config file from disk
 *      and validates the named environment. Throws on missing config
 *      or unknown env so startup fails fast and loudly.
 *
 *   2. `createMcpContextProvider` — returns a memoized async getter
 *      that fetches the deploy token from the OS keychain on first
 *      invocation. Tool dispatchers `await` this; concurrent first
 *      calls share the same in-flight promise so the keychain prompt
 *      surfaces once, not per-call. Failures are not cached, so a
 *      subsequent tool call retries after the operator unlocks the
 *      keychain or runs `scai login`.
 *
 * The Authoring API access token is acquired lazily on first use —
 * recipe and serialization tools handle their own OAuth flow because
 * the authoring credentials may differ from the deploy credentials.
 */

import { resolveEnvironment, type ResolvedEnvironment } from "@/shared/env";
import { getDeployToken } from "@/shared/keychain";
import { createScaiError } from "@/shared/errors";

export interface McpContext {
  envName: string;
  configPath: string;
  resolved: ResolvedEnvironment;
  allowWriteEnabled: boolean;
  /** Cached deploy access token (resolved on first tool call). */
  deployToken: string;
}

export interface BindMcpEnvironmentOptions {
  configPath?: string;
  environmentName?: string;
}

export type McpContextProvider = () => Promise<McpContext>;

export const resolveMcpEnv = (options: BindMcpEnvironmentOptions): ResolvedEnvironment => {
  return resolveEnvironment({
    config: options.configPath,
    environmentName: options.environmentName,
  });
};

const fetchDeployToken = async (resolved: ResolvedEnvironment): Promise<string> => {
  const token = (await getDeployToken(resolved.envName)) ?? resolved.environment.deployToken;
  if (!token) {
    throw createScaiError(
      `Deploy token not found for environment '${resolved.envName}'.`,
      "AUTH_REQUIRED",
      {
        hint: "Run `scai login` for this environment in a separate terminal, then re-invoke the tool.",
      }
    );
  }
  return token;
};

export const createMcpContextProvider = (
  resolved: ResolvedEnvironment,
  configPath: string
): McpContextProvider => {
  let cached: McpContext | undefined;
  let pending: Promise<McpContext> | undefined;
  return async () => {
    if (cached) return cached;
    if (pending) return pending;
    pending = (async () => {
      const deployToken = await fetchDeployToken(resolved);
      const ctx: McpContext = {
        envName: resolved.envName,
        configPath,
        resolved,
        allowWriteEnabled: resolved.environment.allowWrite === true,
        deployToken,
      };
      cached = ctx;
      return ctx;
    })();
    try {
      return await pending;
    } finally {
      if (!cached) pending = undefined;
    }
  };
};

export const bindMcpEnvironment = async (
  options: BindMcpEnvironmentOptions
): Promise<McpContext> => {
  const resolved = resolveMcpEnv(options);
  const provider = createMcpContextProvider(resolved, options.configPath ?? process.cwd());
  return provider();
};
