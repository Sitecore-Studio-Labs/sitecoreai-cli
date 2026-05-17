/**
 * Campaign (Orchestrate API) client resolution — env profile lookup,
 * Orchestrate-scoped token acquisition, and region-resolved host,
 * assembled into the `CampaignApiClientOptions` that every `./api/*`
 * operation takes.
 *
 * This is the orchestration the CLI runners (`./tasks`) and MCP tools
 * share. It is exported from the area barrel so an SDK consumer can
 * obtain a ready client without reaching into the CLI runner layer.
 *
 * Presentation-free: no logger, no stdout, no `process.exit`.
 */
import { resolveEnvironment } from "@/policy/environment";
import { resolveRegionalBaseUrl } from "@/shared/region";
import { acquireCampaignToken } from "./auth";
import { CAMPAIGN_API_HOST_TEMPLATE, type CampaignApiClientOptions } from "./api/types";

/** Options for {@link resolveCampaignClient}. */
export interface ResolveCampaignClientOptions {
  /** Environment profile name; defaults to the configured default env. */
  environmentName?: string;
  /** Base directory for resolving `sitecoreai.cli.json`; defaults to cwd. */
  config?: string;
}

/** A resolved Campaign API client plus the environment it is bound to. */
export interface ResolvedCampaignClient {
  client: CampaignApiClientOptions;
  envName: string;
}

/**
 * Resolve a ready-to-use Campaign (Orchestrate) API client.
 *
 * Resolves the env profile, acquires an Orchestrate-scoped token via the
 * org's AI APIs key, and region-resolves the API host from the org id
 * (an env profile may pin `campaignBaseUrl` to override it). The AI APIs
 * key may lack `platform.tenants:listall`, so region resolution is
 * best-effort and falls back to the default region.
 */
export const resolveCampaignClient = async (
  options: ResolveCampaignClientOptions = {}
): Promise<ResolvedCampaignClient> => {
  const { envName, environment, root } = resolveEnvironment(options);
  const orgId = environment.organizationId;
  const accessToken = await acquireCampaignToken({
    organizationId: orgId,
    brandCredential: orgId ? root.brand?.[orgId] : undefined,
  });
  const baseUrl = await resolveRegionalBaseUrl({
    hostTemplate: CAMPAIGN_API_HOST_TEMPLATE,
    organizationId: environment.organizationId,
    override: (environment as unknown as { campaignBaseUrl?: string }).campaignBaseUrl,
    acquireToken: async () => accessToken,
  });
  return { envName, client: { accessToken, baseUrl } };
};
