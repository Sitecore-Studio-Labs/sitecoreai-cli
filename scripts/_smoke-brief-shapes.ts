/**
 * Capture full payloads from the confirmed Brief API endpoints so we
 * can pin down response schemas. Writes pretty-printed JSON for each
 * to stdout, one object per endpoint.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brief-shapes.ts <NAME> <BRIEF_ID>
 */
import { requestClientCredentialsToken } from "@/serialization/api/auth";

const AUTHORITY = "https://auth.sitecorecloud.io";
const AUDIENCE = "https://api.sitecorecloud.io";
const BASE = "https://co-brief-api-euw.sitecorecloud.io";
const SCOPE = "co.briefs:r co.briefs:w";

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  const briefId = process.argv[3];
  if (!envName || !briefId) {
    process.stderr.write("Usage: tsx scripts/_smoke-brief-shapes.ts <ENV> <BRIEF_ID>\n");
    process.exit(2);
  }
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const clientId = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`];
  const clientSecret = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    process.stderr.write(`Missing env creds for ${envSlug}\n`);
    process.exit(2);
  }

  const token = await requestClientCredentialsToken(
    { authority: AUTHORITY, clientId, clientSecret, audience: AUDIENCE },
    SCOPE
  );
  if (!token.accessToken) process.exit(1);

  const fetchJson = async (path: string): Promise<unknown> => {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
    });
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: text };
    }
  };

  const out = {
    "GET /briefs": await fetchJson("/api/brief/v1/briefs"),
    "GET /briefs/{id}": await fetchJson(`/api/brief/v1/briefs/${briefId}`),
    "GET /brief-types": await fetchJson("/api/brief/v1/brief-types"),
    "GET /tasks?BriefId": await fetchJson(
      `/api/brief/v1/tasks?BriefId=${briefId}&MetadataToLoad=assignees`
    ),
    "GET /comments": await fetchJson(`/api/brief/v1/comments?BriefId=${briefId}`),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
