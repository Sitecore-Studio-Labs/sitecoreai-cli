export type DeployApiClientOptions = {
  baseUrl?: string;
  accessToken: string;
};

export type DeployOrganization = {
  id?: string;
  organizationId?: string;
  name?: string;
  tenantId?: string;
};

export type DeployProject = {
  id?: string;
  projectId?: string;
  name?: string;
  organizationId?: string;
};

/**
 * Lifecycle state of an environment as returned by the Deploy API.
 *
 * The wire field (`provisioningStatus`) is numeric. Values observed
 * directly: `0` = `unprovisioned`, `2` = `provisioned`. Values `1`,
 * `3`, `4` are inferred from the standard Sitecore provisioning state
 * machine and need confirmation against the Deploy API spec; any
 * unrecognized numeric value is normalized to `"unknown"` so consumers
 * never have to write `=== 2` checks.
 *
 * Use `getProvisioningStatus(env)` from `@/deploy/api` to read this —
 * never compare the raw `provisioningStatus` number directly.
 */
export type DeployEnvironmentProvisioningStatus =
  | "unprovisioned"
  | "provisioning"
  | "provisioned"
  | "failed"
  | "deleting"
  | "unknown";

export type DeployEnvironment = {
  id?: string;
  environmentId?: string;
  name?: string;
  type?: string;
  tenantId?: string;
  projectId?: string;
  organizationId?: string;
  host?: string;
  cmUrl?: string;
  cmHost?: string;
  url?: string;
  hosts?: Array<{ hostName?: string; url?: string; hostname?: string }>;
  /** Raw lifecycle code from the Deploy API. Prefer
   *  `getProvisioningStatus(env)` over comparing this number. */
  provisioningStatus?: number;
  provisioningLastFailureMessage?: string;
  lastSuccessfulDeploymentId?: string;
  createdAt?: string;
};

export const DEFAULT_DEPLOY_API_BASE = "https://xmclouddeploy-api.sitecorecloud.io";
export const DEFAULT_MONITORING_API_BASE = "https://xmcloud-monitoring-api.sitecorecloud.io";

export type DeployQueryValue = string | number | boolean;
export type DeployQueryValueList = DeployQueryValue | DeployQueryValue[];

/**
 * Library-overridable transport tuning. When a field is `undefined` the
 * request falls back to the corresponding `SITECOREAI_*` env var (or
 * the built-in default). Pure-library callers (orchestrators, MCP
 * servers, tests) should pass these explicitly so they don't rely on
 * scai's env namespace — the CLI keeps the env-var fallbacks for
 * operator ergonomics.
 */
export type DeployRequestTransport = {
  /** Per-attempt timeout in ms. Default: `SITECOREAI_REQUEST_TIMEOUT_MS` ?? 60_000. 0 disables. */
  timeoutMs?: number;
  /** Total retries on GET-only transient failures. Default: `SITECOREAI_HTTP_RETRIES` ?? 2. */
  maxRetries?: number;
  /** Base backoff in ms. Default: `SITECOREAI_HTTP_RETRY_BASE_MS` ?? 500. */
  retryBaseMs?: number;
  /** Enable per-request debug tracing. Default: `SITECOREAI_TRACE_HTTP === "1"`. */
  traceHttp?: boolean;
};

export type DeployRequestInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  whatIf?: boolean;
  /**
   * Skip the TTY spinner. CLI tasks leave this undefined; library
   * callers should set `silent: true` so the transport doesn't
   * mutate stdout. Defaults to `true` when not a TTY or when
   * `SITECOREAI_QUIET` / `SITECOREAI_JSON` are set.
   */
  silent?: boolean;
  /** Library-overridable transport tuning; see `DeployRequestTransport`. */
  transport?: DeployRequestTransport;
};
