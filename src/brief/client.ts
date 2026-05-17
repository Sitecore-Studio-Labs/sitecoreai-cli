/**
 * Brief API client resolution — env profile lookup, brief-scoped token
 * acquisition, and region-resolved host, assembled into the
 * `BriefApiClientOptions` that every `./api/*` operation takes.
 *
 * This is the orchestration the CLI runners (`./tasks`) and MCP tools
 * share. It is exported from the area barrel so an SDK consumer can
 * obtain a ready client without reaching into the CLI runner layer.
 *
 * Presentation-free: no logger, no stdout, no `process.exit`.
 */
import { resolveEnvironment } from "@/shared/env";
import { resolveRegionalBaseUrl } from "@/shared/region";
import { requestClientCredentialsToken } from "@/serialization/api/auth";
import { acquireBriefToken } from "./auth";
import { BRIEF_API_HOST_TEMPLATE, type BriefApiClientOptions } from "./api/types";

/** Options for {@link resolveBriefClient}. */
export interface ResolveBriefClientOptions {
  /** Environment profile name; defaults to the configured default env. */
  environmentName?: string;
  /** Base directory for resolving `sitecoreai.cli.json`; defaults to cwd. */
  config?: string;
}

/** A resolved Brief API client plus the environment it is bound to. */
export interface ResolvedBriefClient {
  client: BriefApiClientOptions;
  envName: string;
}

/**
 * Resolve a ready-to-use Brief API client for an environment.
 *
 * Resolves the env profile, acquires a `co.briefs:*`-scoped token, and
 * region-resolves the API host from the org id (an env profile may pin
 * `briefBaseUrl` to override it). Because the brief token is
 * scope-restricted, the region lookup mints a separate no-scope M2M
 * token carrying `platform.tenants:listall`.
 */
export const resolveBriefClient = async (
  options: ResolveBriefClientOptions = {}
): Promise<ResolvedBriefClient> => {
  const { envName, environment, root } = resolveEnvironment(options);
  // Carry the org-scoped automation client's non-secret `clientId` from
  // the root config so `resolveClientCredential` can pair it with the
  // org-client secret in the keychain (tier 3).
  const orgClientId = environment.organizationId
    ? root.orgClients[environment.organizationId]?.clientId
    : undefined;
  const accessToken = await acquireBriefToken({
    envName,
    environment: { ...environment, orgClientId },
  });
  const baseUrl = await resolveRegionalBaseUrl({
    hostTemplate: BRIEF_API_HOST_TEMPLATE,
    organizationId: environment.organizationId,
    override: (environment as unknown as { briefBaseUrl?: string }).briefBaseUrl,
    acquireToken: async () => (await requestClientCredentialsToken(environment)).accessToken,
  });
  return { envName, client: { accessToken, baseUrl } };
};
