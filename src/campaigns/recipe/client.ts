/**
 * Resolves a `CampaignApiClientOptions` from a `SyncContext` — the
 * `campaign` kind's bridge between the generic `sync` engine and the
 * Sitecore Orchestrate API.
 *
 * Mirrors `prepareCampaignClient` in `src/campaigns/tasks/index.ts`:
 * resolve the environment, mint an Orchestrate-scoped token via
 * `acquireCampaignToken`, and region-resolve the host through the
 * shared resolver (`campaignBaseUrl` still overrides it outright).
 * Unlike the brand kit's client resolver this is async — the
 * Orchestrate API has no synchronous credential, the token is minted
 * on demand.
 */
import { acquireCampaignToken, CAMPAIGN_API_HOST_TEMPLATE } from "@/campaigns";
import type { CampaignApiClientOptions } from "@/campaigns";
import { resolveEnvironment } from "@/policy/environment";
import { resolveRegionalBaseUrl } from "@/shared/region";
import type { SyncContext } from "@/sync";

/** Build the Orchestrate API client for the context's environment. */
export const resolveCampaignClient = async (
  ctx: SyncContext
): Promise<CampaignApiClientOptions> => {
  const { environment, root } = resolveEnvironment({
    config: ctx.configPath,
    environmentName: ctx.environmentName,
  });
  const orgId = environment.organizationId;
  const accessToken = await acquireCampaignToken({
    organizationId: orgId,
    brandCredential: orgId ? root.brand?.[orgId] : undefined,
  });
  // Host is region-resolved from the org id; resolution is best-effort
  // and falls back to DEFAULT_REGION when the token can't list tenants.
  const baseUrl = await resolveRegionalBaseUrl({
    hostTemplate: CAMPAIGN_API_HOST_TEMPLATE,
    organizationId: environment.organizationId,
    override: (environment as unknown as { campaignBaseUrl?: string }).campaignBaseUrl,
    acquireToken: async () => accessToken,
  });
  return { accessToken, baseUrl };
};
