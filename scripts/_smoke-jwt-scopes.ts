/**
 * Decodes the current automation-client JWT for a given env and prints
 * its scopes (and a couple of other diagnostic claims). Bypasses cli.ts
 * for the same reason the publish-status smoke does — there's unrelated
 * WIP that breaks the CLI entry point on this branch.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-jwt-scopes.ts [envName]
 *
 * Token never leaves the machine — only the parsed payload is printed.
 */
import { resolveEnvironment } from "@/shared/env";
import { getAccessToken } from "@/serialization/sitecore-api/auth";

const decodePart = (b64url: string): unknown => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
};

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const { environment } = resolveEnvironment({ environmentName: envName });
  const token = await getAccessToken(environment);
  if (!token) {
    process.stderr.write(`no token for env '${envName}'\n`);
    process.exit(1);
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    process.stderr.write(`token is not a JWT (got ${parts.length} segments)\n`);
    process.exit(1);
  }
  const header = decodePart(parts[0]) as Record<string, unknown>;
  const payload = decodePart(parts[1]) as Record<string, unknown>;

  const summary = {
    alg: header.alg,
    iss: payload.iss,
    aud: payload.aud,
    azp: payload.azp,
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    scope: payload.scope,
    scp: payload.scp,
    permissions: payload.permissions,
    expSeconds:
      typeof payload.exp === "number" && typeof payload.iat === "number"
        ? payload.exp - payload.iat
        : undefined,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
