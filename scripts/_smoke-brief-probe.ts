/**
 * Reverse-engineering probe for the Sitecore Brief API.
 *
 * The Brief API (`co-brief-api-<region>.sitecorecloud.io`) is not
 * publicly documented. This script tries multiple scope hypotheses to
 * surface which (if any) the operator's M2M client is granted, then
 * calls `GET /api/brief/v1/tasks` with the resulting token to verify
 * end-to-end reachability and learn the response shape.
 *
 * Scopes to try are a guess based on Sitecore naming conventions —
 * once one works, pin it into `src/brief/auth.ts` and the others can
 * be removed from this probe.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brief-probe.ts <NAME> <BRIEF_ID> [BASE_URL]
 *
 *   - NAME: env slug, e.g. "agents" — must match the env vars above.
 *   - BRIEF_ID: a real brief UUID for the tenant. The probe calls
 *     `/tasks?BriefId=<id>&MetadataToLoad=assignees`.
 *   - BASE_URL: optional, defaults to `https://co-brief-api-euw.sitecorecloud.io`.
 *
 * Outputs to stdout: JSON per attempt with `scope`, `tokenPayload`,
 * `apiStatus`, `apiBodyPreview`. Outputs to stderr: progress.
 */
import { requestClientCredentialsToken } from "@/serialization/api/auth";
import { ScaiError } from "@/shared/errors";

const AUTHORITY = "https://auth.sitecorecloud.io";
const AUDIENCE = "https://api.sitecorecloud.io";
const DEFAULT_BASE = "https://co-brief-api-euw.sitecorecloud.io";

const SCOPE_HYPOTHESES: { label: string; scope: string | undefined }[] = [
  { label: "no-scope (let client default)", scope: undefined },
  { label: "co.brief read", scope: "co.brief:r" },
  { label: "co.brief read/write", scope: "co.brief:r co.brief:w" },
  { label: "co.tasks read/write", scope: "co.tasks:r co.tasks:w" },
  { label: "content-ops broad", scope: "co.*:r co.*:w" },
  { label: "brief read (no co prefix)", scope: "brief:r" },
  { label: "openid+profile+offline_access", scope: "openid profile offline_access" },
];

const decodePart = (b64url: string): Record<string, unknown> => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
};

const tryProbe = async (
  label: string,
  scope: string | undefined,
  clientId: string,
  clientSecret: string,
  baseUrl: string,
  briefId: string
): Promise<Record<string, unknown>> => {
  process.stderr.write(`\n--- attempt: ${label} (scope=${scope ?? "<none>"}) ---\n`);
  let accessToken: string;
  try {
    const result = await requestClientCredentialsToken(
      { authority: AUTHORITY, clientId, clientSecret, audience: AUDIENCE },
      scope ?? ""
    );
    if (!result.accessToken) return { label, scope, error: "no_access_token" };
    accessToken = result.accessToken;
  } catch (err) {
    if (err instanceof ScaiError) {
      return { label, scope, authError: { code: err.code, message: err.message, hint: err.hint } };
    }
    return { label, scope, authError: { message: String(err) } };
  }

  const payload = decodePart(accessToken.split(".")[1]);
  const tokenScope = typeof payload.scope === "string" ? payload.scope : "";

  const url = `${baseUrl.replace(/\/$/, "")}/api/brief/v1/tasks?BriefId=${encodeURIComponent(briefId)}&MetadataToLoad=assignees`;
  let apiStatus = 0;
  let apiStatusText = "";
  let apiBodyPreview = "";
  let apiHeaders: Record<string, string> = {};
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    apiStatus = response.status;
    apiStatusText = response.statusText;
    response.headers.forEach((value, key) => {
      apiHeaders[key] = value;
    });
    const text = await response.text();
    apiBodyPreview = text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
  } catch (err) {
    apiStatus = -1;
    apiBodyPreview = `fetch threw: ${String(err)}`;
  }

  return {
    label,
    requestedScope: scope,
    grantedScope: tokenScope,
    tokenAud: payload.aud,
    tokenAzp: payload.azp,
    tokenSub: payload.sub,
    apiStatus,
    apiStatusText,
    apiBodyPreview,
    apiHeaders: {
      "www-authenticate": apiHeaders["www-authenticate"],
      "x-sc-correlation-id": apiHeaders["x-sc-correlation-id"],
      "content-type": apiHeaders["content-type"],
    },
  };
};

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  const briefId = process.argv[3];
  const baseUrl = process.argv[4] ?? DEFAULT_BASE;

  if (!envName || !briefId) {
    process.stderr.write(
      "Usage: tsx scripts/_smoke-brief-probe.ts <ENV_NAME> <BRIEF_ID> [BASE_URL]\n"
    );
    process.exit(2);
  }

  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const clientId = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`];
  const clientSecret = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    process.stderr.write(`Missing SITECOREAI_ENV_${envSlug}_CLIENT_ID / _CLIENT_SECRET in env.\n`);
    process.exit(2);
  }

  process.stderr.write(`> env: ${envName}, briefId: ${briefId}, base: ${baseUrl}\n`);
  process.stderr.write(`> trying ${SCOPE_HYPOTHESES.length} scope hypotheses\n`);

  const results: Record<string, unknown>[] = [];
  for (const h of SCOPE_HYPOTHESES) {
    const r = await tryProbe(h.label, h.scope, clientId, clientSecret, baseUrl, briefId);
    results.push(r);
    process.stderr.write(
      `  → status=${r.apiStatus ?? "-"}, granted="${(r.grantedScope as string | undefined) ?? "-"}"\n`
    );
  }

  process.stdout.write(`${JSON.stringify({ baseUrl, briefId, results }, null, 2)}\n`);

  const winner = results.find(
    (r) => typeof r.apiStatus === "number" && r.apiStatus >= 200 && r.apiStatus < 300
  );
  if (winner) {
    process.stderr.write(
      `\n✅ working scope: requested="${winner.requestedScope ?? "<none>"}", granted="${winner.grantedScope}"\n`
    );
    process.exit(0);
  }
  process.stderr.write(
    "\n❌ no scope hypothesis yielded a 2xx. Review the JSON dump — check error bodies and `www-authenticate` headers for hints.\n"
  );
  process.exit(1);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
