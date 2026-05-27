/**
 * Brief API client resolution — organization lookup, brief-scoped token
 * acquisition, and region-resolved host, assembled into the
 * `BriefApiClientOptions` that every `./api/*` operation takes.
 *
 * This is the orchestration the CLI runners (`./tasks`) and MCP tools
 * share. It is exported from the area barrel so an SDK consumer can
 * obtain a ready client without reaching into the CLI runner layer.
 *
 * The Brief API is **org-scoped** — briefs live at organization scope
 * and the minted token covers the whole org — so this resolves an
 * organization, not an environment, via the shared `resolveOrganization`
 * (no `--environment-name` required). An env profile is still consulted,
 * when one exists, only to supply the automation client that mints the
 * token.
 *
 * Presentation-free: no logger, no stdout, no `process.exit`.
 */
import { resolveOrganization } from "@/policy/organization";
import { resolveRegionalBaseUrl } from "@/shared/region";
import { requestClientCredentialsToken } from "@/auth";
import type { SitecoreApiClientOptions } from "@/auth";
import { acquireBriefToken } from "./auth";
import { BRIEF_API_HOST_TEMPLATE, type BriefApiClientOptions } from "./api/types";

/** Options for {@link resolveBriefClient}. */
export interface ResolveBriefClientOptions {
  /** Explicit organization id; resolved from the env profile otherwise. */
  orgId?: string;
  /** Environment profile name — used only to derive its `organizationId`. */
  environmentName?: string;
  /** Base directory for resolving `sitecoreai.cli.json`; defaults to cwd. */
  config?: string;
}

/** A resolved Brief API client plus the organization it is bound to. */
export interface ResolvedBriefClient {
  client: BriefApiClientOptions;
  orgId: string;
}

/**
 * Resolve a ready-to-use Brief API client for an organization.
 *
 * Resolves the org, acquires a `co.briefs:*`-scoped token (minted from
 * the org's automation client), and region-resolves the API host from
 * the org id (an env profile may pin `briefBaseUrl` to override it).
 * Because the brief token is scope-restricted, the region lookup mints
 * a separate no-scope M2M token.
 */
export const resolveBriefClient = async (
  options: ResolveBriefClientOptions = {}
): Promise<ResolvedBriefClient> => {
  const { orgId, environment, root } = resolveOrganization(options);
  // Brief is org-scoped, but the automation client that mints its token
  // is env- or org-scoped. Carry the matched env profile's client
  // metadata (when one exists) plus the org-scoped client id so the
  // three-tier credential chain can resolve a usable client.
  const credentialEnv: SitecoreApiClientOptions = {
    ...environment,
    organizationId: orgId,
    orgClientId: root.orgClients?.[orgId]?.clientId,
  };
  const accessToken = await acquireBriefToken({ orgId, environment: credentialEnv });
  const baseUrl = await resolveRegionalBaseUrl({
    hostTemplate: BRIEF_API_HOST_TEMPLATE,
    organizationId: orgId,
    override: (environment as { briefBaseUrl?: string } | undefined)?.briefBaseUrl,
    acquireToken: async () => (await requestClientCredentialsToken(credentialEnv)).accessToken,
  });
  return { orgId, client: { accessToken, baseUrl } };
};
