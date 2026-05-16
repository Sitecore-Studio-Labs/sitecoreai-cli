/**
 * Second-stage Brief API discovery: now that we know `co.briefs:r/w`
 * works, sweep a list of plausible endpoint paths to map the real
 * surface area. Reports status, response preview, and content-type
 * per path so we can see which resources exist and what their
 * envelope shapes are.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brief-endpoint-sweep.ts <NAME> [BRIEF_ID] [BASE_URL]
 */
import { requestClientCredentialsToken } from "@/serialization/api/auth";

const AUTHORITY = "https://auth.sitecorecloud.io";
const AUDIENCE = "https://api.sitecorecloud.io";
const DEFAULT_BASE = "https://co-brief-api-euw.sitecorecloud.io";
const SCOPE = "co.briefs:r co.briefs:w";

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  const briefId = process.argv[3] ?? "ae247ac1-a448-4451-829e-7b9733deaa1a";
  const baseUrl = process.argv[4] ?? DEFAULT_BASE;

  if (!envName) {
    process.stderr.write(
      "Usage: tsx scripts/_smoke-brief-endpoint-sweep.ts <ENV> [BRIEF_ID] [BASE]\n"
    );
    process.exit(2);
  }
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const clientId = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`];
  const clientSecret = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    process.stderr.write(`Missing env creds for ${envSlug}\n`);
    process.exit(2);
  }

  process.stderr.write(`> minting token with scope=${SCOPE}\n`);
  const token = await requestClientCredentialsToken(
    { authority: AUTHORITY, clientId, clientSecret, audience: AUDIENCE },
    SCOPE
  );
  if (!token.accessToken) {
    process.stderr.write("No token\n");
    process.exit(1);
  }

  // Candidate paths drawn from REST conventions + observed shape.
  // Brief = subject, tasks = nested collection, "types" / "lookups" / "metadata" common.
  const paths = [
    "/api/brief/v1/briefs",
    "/api/brief/v1/briefs?Limit=5",
    `/api/brief/v1/briefs/${briefId}`,
    "/api/brief/v1/briefs/types",
    "/api/brief/v1/brief-types",
    "/api/brief/v1/types",
    `/api/brief/v1/briefs/${briefId}/tasks`,
    `/api/brief/v1/briefs/${briefId}/assignees`,
    "/api/brief/v1/tasks",
    "/api/brief/v1/tasks?Limit=5",
    `/api/brief/v1/tasks?BriefId=${briefId}`,
    "/api/brief/v1/users",
    "/api/brief/v1/users/me",
    "/api/brief/v1/me",
    "/api/brief/v1/assignees",
    "/api/brief/v1/metadata",
    "/api/brief/v1/statuses",
    "/api/brief/v1/priorities",
    "/api/brief/v1/labels",
    "/api/brief/v1/tags",
    "/api/brief/v1/comments",
    "/api/brief/v1/attachments",
    "/api/brief/v1/workflows",
    "/api/brief/v1/templates",
    "/api/brief/v1/swagger/index.html",
    "/api/brief/v1/swagger/v1/swagger.json",
    "/swagger/index.html",
    "/swagger/v1/swagger.json",
    "/api/brief/v1",
    "/api/brief",
    "/api/v1/briefs",
    "/health",
    "/healthz",
    "/api/brief/v1/health",
  ];

  type Result = {
    path: string;
    status: number;
    contentType: string | null;
    bodyPreview: string;
  };
  const results: Result[] = [];

  for (const path of paths) {
    const url = `${baseUrl.replace(/\/$/, "")}${path}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
      });
      const text = await response.text();
      const preview = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      results.push({
        path,
        status: response.status,
        contentType: response.headers.get("content-type"),
        bodyPreview: preview,
      });
      process.stderr.write(`  ${response.status.toString().padStart(3)} ${path}\n`);
    } catch (err) {
      results.push({
        path,
        status: -1,
        contentType: null,
        bodyPreview: `fetch threw: ${String(err)}`,
      });
      process.stderr.write(`  ERR ${path}\n`);
    }
  }

  // Sort: 2xx first, then 4xx/5xx
  results.sort((a, b) => {
    const ag = a.status >= 200 && a.status < 300 ? 0 : 1;
    const bg = b.status >= 200 && b.status < 300 ? 0 : 1;
    return ag !== bg ? ag - bg : a.status - b.status;
  });

  process.stdout.write(`${JSON.stringify({ baseUrl, results }, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
