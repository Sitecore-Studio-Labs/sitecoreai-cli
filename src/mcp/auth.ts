/**
 * Resolves the environment binding for `scai mcp serve` and packages
 * everything tool handlers need into a single `McpContext`.
 *
 * One server instance, ONE bound/default env — but, since the
 * multi-environment ("Option B") redesign, every environment-scoped
 * tool call may target ANY configured environment. The bound env is
 * the default; `resolveEnvBinding` resolves any other env on demand.
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
 *      keychain or runs `scai setup login`.
 *
 * Per-call retargeting: `resolveEnvBinding(configPath, envName)`
 * resolves any environment on demand and is memoized per
 * `configPath::envName` so a retargeted tool call doesn't re-mint a
 * deploy token on every invocation. The bound `McpContext` is a
 * superset of an `EnvBinding`, so handlers can treat either uniformly.
 *
 * The Authoring API access token is acquired lazily on first use —
 * recipe and serialization tools handle their own OAuth flow because
 * the authoring credentials may differ from the deploy credentials.
 */

import { resolveEnvironment, type ResolvedEnvironment } from "@/policy/environment";
import { getDeployToken } from "@/shared/keychain";
import { createScaiError } from "@/shared/errors";

/**
 * Everything a tool handler needs to talk to ONE environment. The bound
 * `McpContext` is structurally a superset of this — a handler that
 * accepts an `EnvBinding` works equally with the bound context or a
 * per-call retargeted binding.
 */
export interface EnvBinding {
  envName: string;
  resolved: ResolvedEnvironment;
  allowWriteEnabled: boolean;
  /** Deploy access token for this environment. */
  deployToken: string;
}

export interface McpContext extends EnvBinding {
  /** The bound/default environment's name. Same as `envName`. */
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
    // Startup binding: `runMcpServe` enrolls the bound env into the
    // workspace policy right after this resolves, so skip the gate here.
    // Per-call retargeting (`resolveEnvBinding`) stays enforced.
    skipPolicy: true,
  });
};

const fetchDeployToken = async (resolved: ResolvedEnvironment): Promise<string> => {
  const token = (await getDeployToken(resolved.envName)) ?? resolved.environment.deployToken;
  if (!token) {
    throw createScaiError(
      `Deploy token not found for environment '${resolved.envName}'.`,
      "AUTH_REQUIRED",
      {
        hint: "Run `scai setup login` for this environment in a separate terminal, then re-invoke the tool.",
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

/**
 * Per-call environment resolution for the multi-env ("Option B") MCP
 * server. Resolves ANY configured environment on demand — its config,
 * deploy token, and allowWrite flag — into an `EnvBinding`.
 *
 * Generalizes what `bindMcpEnvironment` does for the single bound env:
 * a tool handler that receives an explicit `environmentName` input
 * resolves it here instead of using the bound default.
 *
 * Memoized per `configPath::envName` so a stream of retargeted calls
 * doesn't re-read the config or re-mint a deploy token each time.
 * Failures are NOT cached — a missing token throws `AUTH_REQUIRED`, and
 * the next call retries after the operator runs `scai setup login`.
 */
const bindingCache = new Map<string, EnvBinding>();
const bindingPending = new Map<string, Promise<EnvBinding>>();

export const resolveEnvBinding = async (
  configPath: string,
  envName: string
): Promise<EnvBinding> => {
  const key = `${configPath}::${envName}`;
  const cached = bindingCache.get(key);
  if (cached) return cached;
  const inFlight = bindingPending.get(key);
  if (inFlight) return inFlight;
  const pending = (async (): Promise<EnvBinding> => {
    const resolved = resolveEnvironment({ config: configPath, environmentName: envName });
    const deployToken = await fetchDeployToken(resolved);
    const binding: EnvBinding = {
      envName: resolved.envName,
      resolved,
      allowWriteEnabled: resolved.environment.allowWrite === true,
      deployToken,
    };
    bindingCache.set(key, binding);
    return binding;
  })();
  bindingPending.set(key, pending);
  try {
    return await pending;
  } finally {
    bindingPending.delete(key);
  }
};

/**
 * Test-only — clears the per-`configPath::envName` binding cache so
 * memoization state doesn't leak across `describe` blocks.
 */
export const __resetEnvBindingCacheForTests = (): void => {
  bindingCache.clear();
  bindingPending.clear();
};

/**
 * Resolve the `EnvBinding` an environment-scoped tool should operate
 * against. When `environmentName` is omitted (the common case), returns
 * the bound `McpContext` itself — it IS an `EnvBinding` — so behavior is
 * byte-for-byte identical to the pre-Option-B single-env server. When
 * set, resolves (and memoizes) the named environment via
 * `resolveEnvBinding`.
 */
export const resolveToolBinding = async (
  context: McpContext,
  environmentName: string | undefined
): Promise<EnvBinding> => {
  if (!environmentName || environmentName === context.envName) {
    return context;
  }
  return resolveEnvBinding(context.configPath, environmentName);
};
