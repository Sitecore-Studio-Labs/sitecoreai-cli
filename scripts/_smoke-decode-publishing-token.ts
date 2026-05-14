/**
 * Decodes the publishing-keychain token for an env and prints its
 * scopes + tenant + user claims. Used after `scai publish login` to
 * diagnose why Auth0 issued a token without the requested scopes.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-decode-publishing-token.ts [envName]
 */
import { getPublishingToken } from "@/shared/keychain";

const decodePart = (b64url: string): Record<string, unknown> => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
    string,
    unknown
  >;
};

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const token = await getPublishingToken(envName);
  if (!token) {
    process.stderr.write(`no publishing token for env '${envName}'\n`);
    process.exit(1);
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    process.stderr.write(`not a JWT (${parts.length} segments)\n`);
    process.exit(1);
  }
  const payload = decodePart(parts[1]);

  const summary: Record<string, unknown> = {
    iss: payload.iss,
    aud: payload.aud,
    azp: payload.azp,
    sub: payload.sub,
    scope: payload.scope,
    permissions: payload.permissions,
    expSeconds:
      typeof payload.exp === "number" && typeof payload.iat === "number"
        ? payload.exp - payload.iat
        : undefined,
  };
  // Surface the Sitecore-specific tenant/org claims (they're under
  // namespaced keys like https://auth.sitecorecloud.io/claims/tenant_id).
  for (const key of Object.keys(payload)) {
    if (key.startsWith("https://auth.sitecorecloud.io/claims/")) {
      const short = key.replace("https://auth.sitecorecloud.io/claims/", "");
      summary[`claim:${short}`] = payload[key];
    }
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
