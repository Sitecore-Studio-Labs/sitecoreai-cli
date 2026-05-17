import { resolveEnvironment } from "@/policy/environment";
import { createHygieneApiClient, type HygieneApiClient } from "@/hygiene/api/client";

/**
 * Unified client for ad-hoc TypeScript scripting against a configured
 * scai environment. The intent: replace one-shot imports from `@/`-path
 * internals with a stable, ergonomic entry point that handles env
 * resolution, auth, and client lifecycle in one call.
 *
 * Stability contract: the shape of `ScaiClient` and the `connect`
 * signature are part of the public surface. Internal area clients
 * (currently just `hygiene`) are exposed by reference — their own
 * stability contract lives in `scai/hygiene`. Adding a new area client
 * here is a public-API decision.
 */
export interface ScaiClient {
  envName: string;
  hygiene: HygieneApiClient;
}

export interface ConnectOptions {
  /** Environment name from `sitecoreai.cli.json`. Defaults to `defaultEnvProfile`. */
  envName?: string;
  /** Override the config file path (directory or full path). Defaults to `process.cwd()`. */
  configPath?: string;
}

export const connect = (options: ConnectOptions = {}): ScaiClient => {
  const resolved = resolveEnvironment({
    config: options.configPath,
    environmentName: options.envName,
  });
  const hygiene = createHygieneApiClient({
    environment: resolved.environment,
    request: resolved.timeoutMs ? { timeoutMs: resolved.timeoutMs } : undefined,
  });
  return { envName: resolved.envName, hygiene };
};
