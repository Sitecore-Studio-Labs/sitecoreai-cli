/**
 * Per-environment credential presence — the matrix surfaced by
 * `scai setup status` (text + JSON) and the `scai_overview` MCP tool's
 * discovery output.
 *
 * Per `docs/credentials.md` scai has exactly two kinds of credential:
 * the automation client (provisioned at env scope and/or org scope) and
 * the brand / AI APIs key. A scai-minted automation client is fully
 * present only when both halves agree: the non-secret metadata in the
 * config file (`automationClient` / `orgClients[orgId]`) AND the secret
 * in the OS keychain. This matrix reports the presence of each:
 *
 *   - `envClient` — the env-scoped automation client (config metadata +
 *     keychain secret), or the operator's bring-your-own-client escape
 *     hatch (`clientId` + `useClientCredentials` on the profile; the
 *     secret is supplied via `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`, never
 *     the config file).
 *   - `orgClient` — the org-scoped automation client (config metadata +
 *     keychain secret), shared by every env profile in the organization.
 *   - `brand`     — the brand / AI APIs key for the env's organization.
 *
 * Short-lived tokens (deploy, cm, brief, campaign, …) are NOT
 * credentials and are not reported here.
 *
 * Lives in `shared/` (a leaf module) and takes an already-resolved env
 * profile plus precomputed `hasBrand` / org-client-metadata flags, so it
 * never imports `config/` — the caller does the config read and passes
 * the minimal shape in.
 */

import { getCmClientSecret, getOrgClientSecret } from "./keychain";

/** Which of scai's credentials an environment currently has. */
export type CredentialMatrix = {
  /**
   * Env-scoped automation client — the scai-minted client (its
   * `automationClient` metadata in the config plus the `cm-client:<env>`
   * keychain secret), or the bring-your-own-client escape hatch
   * (`clientId` + `useClientCredentials` on the env profile; the secret
   * is supplied via `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`).
   */
  envClient: boolean;
  /**
   * Org-scoped automation client — its `orgClients[orgId]` metadata in
   * the config plus the `org-client:<orgId>` keychain secret.
   */
  orgClient: boolean;
  /** Brand / AI APIs key for the env's organization. */
  brand: boolean;
};

/**
 * Minimal env-profile shape `resolveCredentialMatrix` needs. A subset of
 * the config's environment type — kept local so this leaf module has no
 * `config/` dependency.
 */
export type CredentialEnvProfile = {
  /** Bring-your-own-client id (escape hatch). */
  clientId?: string;
  /**
   * Bring-your-own-client toggle (escape hatch). When set with a
   * `clientId`, the operator supplies their own automation client; the
   * secret comes from `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`.
   */
  useClientCredentials?: boolean;
  /**
   * Non-secret metadata of the scai-minted env-scoped automation client
   * (`automationClient` block on the env profile). Presence of its
   * `clientId` is the config half of the env-client presence check.
   */
  automationClient?: { clientId?: string };
  /** Organization the env belongs to — keys the org-scoped client. */
  organizationId?: string;
};

/**
 * Resolve the credential matrix for one environment. Each scai-minted
 * automation client is present only when both halves agree: the
 * non-secret metadata in the config AND the secret in the keychain.
 * `hasBrand` and `hasOrgClientMetadata` are taken precomputed (the
 * caller checks `root.brand[orgId]` / `root.orgClients[orgId]`).
 *
 * `resolveCredentialMatrix` is a pure presence-reporter — it never
 * mints, never writes, and never throws on a missing credential.
 */
export const resolveCredentialMatrix = async (
  envName: string,
  env: CredentialEnvProfile,
  hasBrand: boolean,
  hasOrgClientMetadata: boolean
): Promise<CredentialMatrix> => {
  // Env-scoped client: config metadata (`automationClient.clientId`)
  // plus the keychain secret. Both halves required.
  const cmSecret = await getCmClientSecret(envName);
  const hasMintedEnvClient = Boolean(env.automationClient?.clientId) && Boolean(cmSecret);
  // Org-scoped client: config metadata (`orgClients[orgId]`) plus the
  // keychain secret.
  const orgSecret = env.organizationId ? await getOrgClientSecret(env.organizationId) : undefined;
  const hasOrgClient = hasOrgClientMetadata && Boolean(orgSecret);
  // The bring-your-own-client escape hatch: the operator declares their
  // own `clientId` + `useClientCredentials` on the profile and feeds the
  // secret in via `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`. The matrix is a
  // presence reporter and never reads secrets, so it reports the BYO
  // intent (id + toggle) rather than checking the env var.
  const hasByoClient = Boolean(env.clientId && env.useClientCredentials);
  return {
    envClient: hasMintedEnvClient || hasByoClient,
    orgClient: hasOrgClient,
    brand: hasBrand,
  };
};
