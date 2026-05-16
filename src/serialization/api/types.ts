/**
 * Public option shape for the Sitecore Management + Authoring GraphQL
 * clients. Library callers construct one of these directly. The CLI
 * passes its full `EnvironmentConfiguration` (which structurally
 * satisfies this interface) — no per-call adapter.
 *
 * Why a structural subset and not the full config: `EnvironmentConfiguration`
 * has 30+ fields covering deploy-token caching, recipe roots, allow-write
 * gates, tenant identifiers, etc. — none of which the GraphQL transport
 * uses. Library callers (orchestrators, MCP servers, tests) should
 * construct only the auth + host bits they actually need.
 *
 * `host` is functionally required for any API call (every transport
 * throws `INPUT_INVALID` when it's missing), but it stays optional in
 * the type so this interface is satisfied by `EnvironmentConfiguration`
 * — which has it optional because the config wizard may not have set
 * it yet at construction time.
 */
import type { AutomationClientMetadata } from "@/config/types";

export interface SitecoreApiClientOptions {
  /** CM hostname (e.g. `https://xmc-org-env.sitecorecloud.io`). */
  host?: string;
  /** Sitecore organization id — used to resolve org-scoped credentials. */
  organizationId?: string;
  /** OAuth identity authority (e.g. `https://auth.sitecorecloud.io`). */
  authority?: string;
  /** OAuth client id. */
  clientId?: string;
  /** OAuth client secret (required for client-credentials flow). */
  clientSecret?: string;
  /**
   * Non-secret metadata of the scai-minted env-scoped automation client.
   * Carried through from `EnvironmentConfiguration.automationClient` so
   * the auth layer can pair `automationClient.clientId` with the secret
   * it reads from the OS keychain. Only `clientId` is used here.
   */
  automationClient?: AutomationClientMetadata;
  /**
   * `clientId` of the scai-minted org-scoped automation client — read
   * from the root config's `orgClients[organizationId]` block. The org
   * client lives at the root of the config, not on the env profile, so
   * a caller that wants tier-3 (org-client) resolution must populate
   * this from the resolved `RootConfiguration`.
   */
  orgClientId?: string;
  /** OAuth audience. Defaults to `https://api.sitecorecloud.io`. */
  audience?: string;
  /** Pre-obtained access token. Bypasses OAuth flow entirely. */
  accessToken?: string;
  /** Pre-obtained refresh token. */
  refreshToken?: string;
  /** Additional refresh-token request parameters (rarely needed). */
  refreshTokenParameters?: Record<string, string>;
  /** Use client-credentials flow. Defaults to false; requires `clientSecret`. */
  useClientCredentials?: boolean;
  /**
   * Cache acquired tokens in the OS keychain. Defaults to true.
   * Has no effect when `name` is unset — caching is keyed by env name.
   * Library callers that bring their own cache should pass
   * `cacheAuthenticationToken: false`.
   */
  cacheAuthenticationToken?: boolean;
  /** Environment name; used as the keychain cache key. */
  name?: string;
}
