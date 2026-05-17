/**
 * Campaign (Orchestrate API) client resolution — organization lookup,
 * Orchestrate-scoped token acquisition, and region-resolved host,
 * assembled into the `CampaignApiClientOptions` that every `./api/*`
 * operation takes.
 *
 * This is the orchestration the CLI runners (`./tasks`) and MCP tools
 * share. It is exported from the area barrel so an SDK consumer can
 * obtain a ready client without reaching into the CLI runner layer.
 *
 * The Orchestrate API is **org-scoped** — it authenticates with the
 * org's AI APIs key and lives at organization scope — so this resolves
 * an organization, not an environment, via the shared `resolveOrganization`
 * (no `--environment-name` required).
 *
 * Presentation-free: no logger, no stdout, no `process.exit`.
 */
import { resolveOrganization } from "@/policy/organization";
import { resolveRegionalBaseUrl } from "@/shared/region";
import { acquireCampaignToken } from "./auth";
import { CAMPAIGN_API_HOST_TEMPLATE, type CampaignApiClientOptions } from "./api/types";

/** Options for {@link resolveCampaignClient}. */
export interface ResolveCampaignClientOptions {
  /** Explicit organization id; resolved from the env profile otherwise. */
  orgId?: string;
  /** Environment profile name — used only to derive its `organizationId`. */
  environmentName?: string;
  /** Base directory for resolving `sitecoreai.cli.json`; defaults to cwd. */
  config?: string;
}

/** A resolved Campaign API client plus the organization it is bound to. */
export interface ResolvedCampaignClient {
  client: CampaignApiClientOptions;
  orgId: string;
}

/**
 * Resolve a ready-to-use Campaign (Orchestrate) API client.
 *
 * Resolves the organization, acquires an Orchestrate-scoped token via the
 * org's AI APIs key, and region-resolves the API host from the org id
 * (an env profile may pin `campaignBaseUrl` to override it). The AI APIs
 * key may lack `platform.tenants:listall`, so region resolution is
 * best-effort and falls back to the default region.
 */
export const resolveCampaignClient = async (
  options: ResolveCampaignClientOptions = {}
): Promise<ResolvedCampaignClient> => {
  const { orgId, environment, root } = resolveOrganization(options);
  const accessToken = await acquireCampaignToken({
    organizationId: orgId,
    brandCredential: root.brand?.[orgId],
  });
  const baseUrl = await resolveRegionalBaseUrl({
    hostTemplate: CAMPAIGN_API_HOST_TEMPLATE,
    organizationId: orgId,
    override: (environment as { campaignBaseUrl?: string } | undefined)?.campaignBaseUrl,
    acquireToken: async () => accessToken,
  });
  return { orgId, client: { accessToken, baseUrl } };
};
