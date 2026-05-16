/**
 * Per-environment credential presence — the four-way matrix surfaced by
 * `scai setup status` (text + JSON) and the `scai_overview` MCP tool's
 * discovery output.
 *
 * Lives in `shared/` (a leaf module) and takes an already-resolved env
 * profile plus a precomputed `hasBrand` flag, so it never imports
 * `config/` — the caller does the config read and passes the minimal
 * shape in.
 */

import { getCmClientCredential, getDeployToken } from "./keychain";

/** Which of the four credential types an environment currently has. */
export type CredentialMatrix = {
  /** Deploy API token (keychain or config). Powers deploy + the clients API. */
  deploy: boolean;
  /** scai-minted, environment-scoped CM automation client (keychain). */
  cmClient: boolean;
  /** Brand credential for the env's organization (brand kits). */
  brand: boolean;
  /** Brief (Content Operations) client-credentials on the env profile. */
  brief: boolean;
};

/**
 * Minimal env-profile shape `resolveCredentialMatrix` needs. A subset of
 * the config's environment type — kept local so this leaf module has no
 * `config/` dependency.
 */
export type CredentialEnvProfile = {
  clientId?: string;
  clientSecret?: string;
  authority?: string;
  deployToken?: string;
};

/**
 * Resolve the credential matrix for one environment. Reads the keychain
 * for the deploy token and the scai-minted CM client; takes
 * `hasBrand` precomputed (the caller checks `root.brand[orgId]`).
 */
export const resolveCredentialMatrix = async (
  envName: string,
  env: CredentialEnvProfile,
  hasBrand: boolean
): Promise<CredentialMatrix> => {
  const deployToken = (await getDeployToken(envName)) ?? env.deployToken;
  const cmClient = await getCmClientCredential(envName);
  return {
    deploy: Boolean(deployToken),
    cmClient: Boolean(cmClient),
    brand: hasBrand,
    brief: Boolean(env.clientId && env.clientSecret && env.authority),
  };
};
