/**
 * Re-tests the M2M client-credentials path with the TENANT-tier
 * publishing scopes (`xmcpub.jobs.t:r/w` + `xmcpub.queue:r`) — the
 * ones a regular automation client carries, per the Publishing API
 * architect. The earlier test used `xmcpub.jobs.a:*` (admin variants)
 * and failed because those aren't on the automation client's grant.
 *
 * Requires SITECOREAI_M2M_CLIENT_SECRET in env. Pure read probe:
 * mints a token, decodes it, then calls GET /jobs/{probe} to confirm
 * the publishing API accepts it.
 *
 * Usage:
 *   SITECOREAI_M2M_CLIENT_SECRET=… pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-m2m-t-scopes.ts [clientId] [audience]
 */
import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import { ScaiError } from "@/shared/errors";

const SCOPES = "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";

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
  const audience = process.argv[3] ?? "https://api.sitecorecloud.io";
  const clientSecret = process.env.SITECOREAI_M2M_CLIENT_SECRET;
  const authority = process.env.SITECOREAI_AUTHORITY ?? "https://auth.sitecorecloud.io";

  if (!clientSecret) {
    process.stderr.write("Set SITECOREAI_M2M_CLIENT_SECRET in env first.\n");
    process.exit(2);
  }

  process.stderr.write(`> client_id: ${clientId}\n`);
  process.stderr.write(`> audience:  ${audience}\n`);
  process.stderr.write(`> scope:     ${SCOPES}\n`);

  let accessToken: string;
  try {
    const result = await requestClientCredentialsToken(
      { authority, clientId, clientSecret, audience },
      SCOPES
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
        allScopes: granted,
        publishingScopesPresent: missing.length === 0,
        missing,
      },
      null,
      2
    )}\n`
  );

  if (missing.length > 0) {
    process.stderr.write(`\n⚠️  Token issued but stripped publishing scopes.\n`);
    process.exit(3);
  }

  // Hit the Publishing API to confirm the token works.
  const url = "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs/probe-id";
  process.stderr.write(`\n> GET ${url}\n`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await response.text();
  process.stdout.write(
    `\n${JSON.stringify(
      { status: response.status, statusText: response.statusText, body: body.slice(0, 400) },
      null,
      2
    )}\n`
  );
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
