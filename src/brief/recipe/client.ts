/**
 * Resolves a `BriefApiClientOptions` from a `SyncContext` — the
 * `brief-type` kind's bridge between the generic `sync` engine and the
 * Sitecore Content Operations Brief API.
 *
 * Unlike the Brand client (a synchronous config read), the Brief API has
 * no interactive login: a token is always minted from the environment's
 * M2M client credentials. `resolveBriefClient` is therefore async — it
 * mirrors how `src/brief/tasks` builds its client, just driven off the
 * generic `SyncContext` instead of CLI options: same shared region
 * resolver, same `briefBaseUrl` override.
 */
import { acquireBriefToken, BRIEF_API_HOST_TEMPLATE } from "@/brief";
import type { BriefApiClientOptions } from "@/brief";
import { resolveEnvironment } from "@/policy/environment";
import { resolveRegionalBaseUrl } from "@/shared/region";
import { requestClientCredentialsToken } from "@/auth";
import { createScaiError } from "@/shared/errors";
import type { SyncContext } from "@/sync";

/** Environment profiles may carry a per-env Brief API host override. */
type BriefBaseUrlCarrier = { briefBaseUrl?: string };

/** Build the Brief API client for the context's environment. */
export const resolveBriefClient = async (ctx: SyncContext): Promise<BriefApiClientOptions> => {
  const { environment, root } = resolveEnvironment({
    config: ctx.configPath,
    environmentName: ctx.environmentName,
  });
  // The Brief API is org-scoped; the sync context always carries an
  // explicit environment, so the org id comes off that env profile.
  const orgId = environment.organizationId;
  if (!orgId) {
    throw createScaiError(
      `Environment '${ctx.environmentName ?? "(default)"}' has no organizationId; the Brief API is org-scoped.`,
      "INPUT_INVALID",
      { hint: "Set organizationId on the env profile in sitecoreai.cli.json." }
    );
  }
  // Carry the org-scoped automation client's non-secret `clientId` from
  // the root config so `resolveClientCredential` can pair it with the
  // org-client secret in the keychain (tier 3).
  const orgClientId = root.orgClients[orgId]?.clientId;
  const accessToken = await acquireBriefToken({
    orgId,
    environment: { ...environment, orgClientId },
  });
  // Host is region-resolved from the org id; an env profile may pin
  // `briefBaseUrl` to override it. The brief token is scoped to
  // `co.briefs:*`, so the lookup mints a separate no-scope M2M token.
  const baseUrl = await resolveRegionalBaseUrl({
    hostTemplate: BRIEF_API_HOST_TEMPLATE,
    organizationId: environment.organizationId,
    override: (environment as unknown as BriefBaseUrlCarrier).briefBaseUrl,
    acquireToken: async () => (await requestClientCredentialsToken(environment)).accessToken,
  });
  return { accessToken, baseUrl };
};
