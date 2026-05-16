/**
 * Resolves a `BrandApiClientOptions` from a `SyncContext` — the
 * `brand-kit` kind's bridge between the generic `sync` engine and the
 * AI Skills Brand Management API.
 */
import { readRootConfiguration } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import type { BrandApiClientOptions } from "@/brand";
import type { SyncContext } from "@/sync";

/** Build the Brand Management API client for the context's environment. */
export const resolveBrandClient = (ctx: SyncContext): BrandApiClientOptions => {
  const root = readRootConfiguration(ctx.configPath ?? process.cwd(), ctx.environmentName);
  const orgId = root.environments[ctx.environmentName]?.organizationId;
  if (!orgId) {
    throw createScaiError(
      `Cannot resolve organizationId for environment "${ctx.environmentName}".`,
      "INPUT_INVALID",
      { hint: "Set organizationId on the env profile in sitecoreai.cli.json." }
    );
  }
  const credential = root.aiSkills?.[orgId];
  if (!credential) {
    throw createScaiError(
      `No AI Skills credential configured for org "${orgId}".`,
      "AUTH_AI_SKILLS_REQUIRED",
      { hint: `Run \`scai setup login ai-skills -n ${ctx.environmentName}\` to provision one.` }
    );
  }
  return { orgId, credential };
};
