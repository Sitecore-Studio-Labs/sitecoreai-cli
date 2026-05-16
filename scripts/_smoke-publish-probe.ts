/**
 * Config-bypassing probe: validates that a given clientId + clientSecret
 * can mint a publishing-scoped token AND that the Publishing API
 * accepts it. Useful for testing env-level automation client
 * credentials before adding them to sitecoreai.cli.json.
 *
 * Reads credentials from env vars; whichever env name you pass as
 * the first arg determines the var name pattern scai would normally
 * use, so swapping in/out of the real env profile is a no-op later.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-probe.ts <NAME> [jobId]
 *
 * Example:
 *   SITECOREAI_ENV_AGENTS_CLIENT_ID='...' SITECOREAI_ENV_AGENTS_CLIENT_SECRET='...' \
 *     pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-probe.ts Agents probe-id
 */
import { requestClientCredentialsToken } from "@/serialization/api/auth";
import { ScaiError } from "@/shared/errors";

const SCOPES = "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";
const AUTHORITY = "https://auth.sitecorecloud.io";
const AUDIENCE = "https://api.sitecorecloud.io";
const API_URL = "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs";

const decodePart = (b64url: string): Record<string, unknown> => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
};

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const jobId = process.argv[3] ?? "probe-id";
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const idVar = `SITECOREAI_ENV_${envSlug}_CLIENT_ID`;
  const secretVar = `SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`;
  const clientId = process.env[idVar];
  const clientSecret = process.env[secretVar];

  process.stderr.write(`> env: ${envName}\n`);
  process.stderr.write(
    `> ${idVar}:     ${clientId ? `<set, len=${clientId.length}>` : "<NOT SET>"}\n`
  );
  process.stderr.write(
    `> ${secretVar}: ${clientSecret ? `<set, len=${clientSecret.length}>` : "<NOT SET>"}\n`
  );

  if (!clientId || !clientSecret) {
    process.stderr.write(`\nSet both env vars above before running.\n`);
    process.exit(2);
  }

  process.stderr.write(`\n> [1/3] minting token via client_credentials with scope=${SCOPES}\n`);
  let accessToken: string;
  try {
    const result = await requestClientCredentialsToken(
      { authority: AUTHORITY, clientId, clientSecret, audience: AUDIENCE },
      SCOPES
    );
    if (!result.accessToken) {
      process.stderr.write(`FAIL: no access_token returned\n`);
      process.exit(1);
    }
    accessToken = result.accessToken;
  } catch (err) {
    if (err instanceof ScaiError) {
      process.stderr.write(`FAIL [${err.code}] ${err.message}\n`);
      if (err.hint) process.stderr.write(`HINT  ${err.hint}\n`);
      process.exit(err.exitCode);
    }
    throw err;
  }

  process.stderr.write(`> [2/3] decoding token, checking scopes\n`);
  const payload = decodePart(accessToken.split(".")[1]);
  const tokenScope = typeof payload.scope === "string" ? payload.scope : "";
  const granted = tokenScope.split(/\s+/).filter(Boolean);
  const want = ["xmcpub.jobs.t:r", "xmcpub.jobs.t:w", "xmcpub.queue:r"];
  const missing = want.filter((s) => !granted.includes(s));

  process.stdout.write(
    `${JSON.stringify(
      {
        aud: payload.aud,
        azp: payload.azp,
        sub: payload.sub,
        grantedPublishingScopes: granted.filter((s) => s.startsWith("xmcpub.")),
        allGrantedScopes: granted,
        publishingScopesPresent: missing.length === 0,
        missing,
      },
      null,
      2
    )}\n`
  );

  if (missing.length > 0) {
    process.stderr.write(
      `\n⚠️  Token issued but missing publishing scopes. Check the Cloud Portal: this client must be ENVIRONMENT-LEVEL, not org-level.\n`
    );
    process.exit(3);
  }

  process.stderr.write(`\n> [3/3] GET ${API_URL}/${encodeURIComponent(jobId)}\n`);
  const response = await fetch(`${API_URL}/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await response.text();
  process.stdout.write(
    `\n${JSON.stringify(
      {
        status: response.status,
        statusText: response.statusText,
        body: body.length > 500 ? body.slice(0, 500) + "…" : body,
      },
      null,
      2
    )}\n`
  );
  if (response.ok || response.status === 404) {
    process.stderr.write(
      `\n✅ Publishing API reachable. ${response.status} is the expected shape for a probe-id (404 = job not found, but auth passed).\n`
    );
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
