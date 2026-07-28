/**
 * Resolves a `BrandApiClientOptions` from a `SyncContext` — the
 * `brand-kit` kind's bridge between the generic `sync` engine and the
 * Brand Management API.
 */
import { readRootConfiguration } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import type { BrandApiClientOptions } from "../api/client";
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
  const credential = root.brand?.[orgId];
  if (!credential) {
    throw createScaiError(
      `No Brand credential configured for org "${orgId}".`,
      "AUTH_BRAND_REQUIRED",
      { hint: `Run \`scai setup login brand -n ${ctx.environmentName}\` to provision one.` }
    );
  }
  return { orgId, credential };
};
