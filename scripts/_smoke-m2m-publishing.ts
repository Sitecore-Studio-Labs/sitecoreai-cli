/**
 * One-shot M2M client-credentials probe with publishing scopes.
 *
 * Requires SITECOREAI_M2M_CLIENT_SECRET to be set in env (the user
 * pastes it once for this run; never persisted). client_id defaults
 * to the user's existing Portal-created M2M client `HVRrmu...` but
 * can be overridden.
 *
 * Three-step output:
 *   1. Request a client-credentials token with publishing scopes
 *   2. Decode it and verify the scopes are actually present
 *   3. If scopes present, call GET /authoring/publishing/v1/jobs to
 *      confirm the API accepts the token
 *
 * Token + secret never touch disk or stdout. Scopes are printed.
 *
 * Usage:
 *   SITECOREAI_M2M_CLIENT_SECRET=… pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-m2m-publishing.ts [clientId] [audience]
 */
import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import { listPublishJobs } from "@/publishing/sitecore-api/client";
import { ScaiError } from "@/shared/errors";

const PUBLISHING_SCOPES = "xmcpub.jobs.a:r xmcpub.jobs.a:w xmcpub.queue:r";

const decodePart = (b64url: string): Record<string, unknown> => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
    string,
    unknown
  >;
};

const main = async (): Promise<void> => {
  const clientId = process.argv[2] ?? "HVRrmuiQ5m6djc2WFJGVjQIqXKZGrqh1";
  const audience = process.argv[3] ?? "https://api-webapp.sitecorecloud.io";
  const clientSecret = process.env.SITECOREAI_M2M_CLIENT_SECRET;
  const authority =
    process.env.SITECOREAI_AUTHORITY ?? "https://auth.sitecorecloud.io";

  if (!clientSecret) {
    process.stderr.write(
      "Set SITECOREAI_M2M_CLIENT_SECRET in env before running. Example:\n" +
        "  SITECOREAI_M2M_CLIENT_SECRET=<secret> pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-m2m-publishing.ts\n"
    );
    process.exit(2);
  }

  process.stderr.write(`> client_id: ${clientId}\n`);
  process.stderr.write(`> authority: ${authority}\n`);
  process.stderr.write(`> audience: ${audience}\n`);
  process.stderr.write(`> scope: ${PUBLISHING_SCOPES}\n`);
  process.stderr.write(`> POST oauth/token (grant_type=client_credentials)\n`);

  let accessToken: string;
  try {
    const result = await requestClientCredentialsToken(
      { authority, clientId, clientSecret, audience },
      PUBLISHING_SCOPES
    );
    if (!result.accessToken) {
      process.stderr.write("FAIL: no access_token returned\n");
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

  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    process.stderr.write("not a JWT\n");
    process.exit(1);
  }
  const payload = decodePart(parts[1]);
  const tokenScope = typeof payload.scope === "string" ? payload.scope : "";
  const granted = tokenScope.split(/\s+/).filter(Boolean);
  const requested = ["xmcpub.jobs.a:r", "xmcpub.jobs.a:w", "xmcpub.queue:r"];
  const missing = requested.filter((s) => !granted.includes(s));

  const tokenInfo = {
    aud: payload.aud,
    azp: payload.azp,
    sub: payload.sub,
    grantedScopes: granted,
    publishingScopesPresent: missing.length === 0,
    missingScopes: missing,
  };
  process.stdout.write(`${JSON.stringify(tokenInfo, null, 2)}\n`);

  if (missing.length > 0) {
    process.stderr.write(
      `\n⚠️  Auth0 issued a token but stripped the publishing scopes. The Portal-created M2M client still doesn't grant xmcpub.*\n`
    );
    process.exit(3);
  }

  process.stderr.write(`\n> GET /authoring/publishing/v1/jobs\n`);
  try {
    const jobs = await listPublishJobs({ accessToken });
    process.stderr.write(
      `\n✅ Publishing API call succeeded — ${jobs.length} job(s) returned.\n`
    );
    process.stdout.write(`${JSON.stringify({ jobs }, null, 2)}\n`);
  } catch (err) {
    if (err instanceof ScaiError) {
      process.stderr.write(
        `\n❌ Publishing API call failed despite valid scopes — [${err.code}] ${err.message}\n`
      );
      if (err.hint) process.stderr.write(`HINT  ${err.hint}\n`);
      process.exit(err.exitCode);
    }
    throw err;
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
