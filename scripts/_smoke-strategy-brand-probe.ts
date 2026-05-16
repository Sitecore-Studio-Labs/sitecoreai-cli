/**
 * Strategy "Brand" API discovery probe (STAGING).
 *
 * Sitecore is staging an unreleased Strategy service that exposes a
 * `brand` resource:
 *
 *   GET https://co-strategy-api-euw-staging.sitecore-staging.cloud
 *       /api/brand/v1/brands?pageNumber=1&pageSize=20
 *
 * This script reverse-engineers that surface so scai can wire a client
 * ahead of GA. It is deliberately READ-ONLY — it lists brands and
 * OPTIONS-probes the collection + item routes; it never POSTs/PUTs/
 * DELETEs. Re-run with explicit write probing once the read shape and
 * the destructive-ops consent model are settled.
 *
 * Auth: the staging environment has its own Auth0 tenant. Supply
 * staging M2M credentials + authority via env vars — production
 * `sitecoreai.cli.json` profiles will NOT work here:
 *
 *   SITECOREAI_STRATEGY_AUTHORITY   (default https://auth-staging.sitecorecloud.io)
 *   SITECOREAI_STRATEGY_AUDIENCE    (default https://api.sitecorecloud.io)
 *   SITECOREAI_STRATEGY_CLIENT_ID
 *   SITECOREAI_STRATEGY_CLIENT_SECRET
 *   SITECOREAI_STRATEGY_SCOPE       (optional — omit to let Auth0 grant
 *                                    whatever the client carries, the
 *                                    pattern the Brief probe used)
 *
 * Usage:
 *   SITECOREAI_STRATEGY_CLIENT_ID='...' \
 *   SITECOREAI_STRATEGY_CLIENT_SECRET='...' \
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-strategy-brand-probe.ts [BASE_URL]
 */
import { requestClientCredentialsToken } from "@/serialization/api/auth";

// Verified 2026-05-15 against the staging strategy tenant: the authority
// + audience below mint a valid token. The Brands API itself is
// feature-flagged off (`BRANDS_API_DISABLED`) for the probed tenant —
// enable it, then re-run to capture the brand resource shapes.
const DEFAULT_BASE = "https://co-strategy-api-euw-staging.sitecore-staging.cloud";
const DEFAULT_AUTHORITY = "https://auth-staging-1.sitecore-staging.cloud";
const DEFAULT_AUDIENCE = "https://api-staging.sitecore-staging.cloud";

type ProbeRecord = {
  step: string;
  method: string;
  path: string;
  status: number;
  contentType: string | null;
  allow: string | null;
  wwwAuthenticate: string | null;
  bodyPreview: string;
  parsed?: unknown;
};

const runRequest = async (
  baseUrl: string,
  token: string | undefined,
  step: string,
  method: string,
  path: string
): Promise<ProbeRecord> => {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { method, headers });
  const text = await response.text();
  const preview = text.length > 800 ? `${text.slice(0, 800)}…` : text;
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  process.stderr.write(
    `  ${response.status.toString().padStart(3)} ${method.padEnd(7)} ${path}  [${step}]\n`
  );
  return {
    step,
    method,
    path,
    status: response.status,
    contentType: response.headers.get("content-type"),
    allow: response.headers.get("allow"),
    wwwAuthenticate: response.headers.get("www-authenticate"),
    bodyPreview: preview,
    parsed,
  };
};

const main = async (): Promise<void> => {
  const baseUrl = process.argv.find((a) => a.startsWith("https://")) ?? DEFAULT_BASE;
  const authority = process.env.SITECOREAI_STRATEGY_AUTHORITY ?? DEFAULT_AUTHORITY;
  const audience = process.env.SITECOREAI_STRATEGY_AUDIENCE ?? DEFAULT_AUDIENCE;
  const clientId = process.env.SITECOREAI_STRATEGY_CLIENT_ID;
  const clientSecret = process.env.SITECOREAI_STRATEGY_CLIENT_SECRET;
  const scope = process.env.SITECOREAI_STRATEGY_SCOPE;

  if (!clientId || !clientSecret) {
    process.stderr.write(
      "Missing SITECOREAI_STRATEGY_CLIENT_ID / SITECOREAI_STRATEGY_CLIENT_SECRET.\n" +
        "These must be STAGING credentials — production sitecoreai.cli.json profiles do not work here.\n"
    );
    process.exit(2);
  }

  process.stderr.write(`> authority=${authority}\n`);
  process.stderr.write(`> audience=${audience}\n`);
  process.stderr.write(`> scope=${scope ?? "(none — Auth0 grants client's default set)"}\n`);
  let token: string | undefined;
  try {
    const result = await requestClientCredentialsToken(
      { authority, clientId, clientSecret, audience },
      scope
    );
    token = result.accessToken;
    process.stderr.write(`> token minted, len=${token?.length ?? 0}\n\n`);
  } catch (error) {
    process.stderr.write(`> token mint FAILED: ${String(error)}\n`);
    process.stderr.write(
      "> If this is a 403 scope error, set SITECOREAI_STRATEGY_SCOPE to the granted scope.\n" +
        "> If this is an unknown_client error, the clientId is not registered in this Auth0 tenant.\n\n"
    );
  }

  const records: ProbeRecord[] = [];
  records.push(
    await runRequest(
      baseUrl,
      token,
      "list-brands",
      "GET",
      "/api/brand/v1/brands?pageNumber=1&pageSize=20"
    )
  );
  records.push(
    await runRequest(baseUrl, token, "collection-options", "OPTIONS", "/api/brand/v1/brands")
  );

  // If list returned a brand, OPTIONS-probe the item route to learn the
  // write surface (Allow header) without mutating anything.
  const first =
    records[0].parsed &&
    typeof records[0].parsed === "object" &&
    "data" in (records[0].parsed as Record<string, unknown>)
      ? ((records[0].parsed as Record<string, unknown>).data as Array<{ id?: string }>)[0]
      : undefined;
  if (first?.id) {
    records.push(
      await runRequest(
        baseUrl,
        token,
        "item-options",
        "OPTIONS",
        `/api/brand/v1/brands/${first.id}`
      )
    );
    records.push(
      await runRequest(baseUrl, token, "item-get", "GET", `/api/brand/v1/brands/${first.id}`)
    );
  }

  // Sweep sibling routes to map the wider Strategy surface.
  for (const path of [
    "/api/brand/v1",
    "/api/brand/v1/brands/types",
    "/api/strategy/v1",
    "/swagger/v1/swagger.json",
    "/api/brand/v1/swagger/v1/swagger.json",
  ]) {
    records.push(await runRequest(baseUrl, token, "sweep", "GET", path));
  }

  process.stdout.write(`${JSON.stringify({ baseUrl, authority, records }, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
