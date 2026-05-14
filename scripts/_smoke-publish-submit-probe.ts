/**
 * Probes POST /authoring/publishing/v1/jobs with progressively-richer
 * request bodies to discover the schema. Each variant prints the
 * status + body so we can read the API's validation errors and learn
 * what fields are required / accepted.
 *
 * Auth is the same env-level credential the status probe used. Token
 * is minted once and reused across variants. NO actual publish will
 * happen if the API rejects every variant — the smoke is designed to
 * be exploratory and shape-discovery, not to fire a real publish.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-submit-probe.ts <NAME>
 */
import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";

const SCOPES = "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";
const AUTHORITY = "https://auth.sitecorecloud.io";
const AUDIENCE = "https://api.sitecorecloud.io";
const SUBMIT_URL = "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "Agents";
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const clientId = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`];
  const clientSecret = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    process.stderr.write(`Set SITECOREAI_ENV_${envSlug}_CLIENT_ID and _CLIENT_SECRET first.\n`);
    process.exit(2);
  }
  process.stderr.write(`> minting token for ${envName}\n`);
  const tokenResult = await requestClientCredentialsToken(
    { authority: AUTHORITY, clientId, clientSecret, audience: AUDIENCE },
    SCOPES
  );
  const accessToken = tokenResult.accessToken;
  if (!accessToken) {
    process.stderr.write("FAIL: no token returned\n");
    process.exit(1);
  }

  // A progression from empty → richer body. All variants use an
  // obviously-non-existent item path (`/scai-probe-does-not-exist`)
  // so even if the API accepts the shape it can't fire a real
  // publish — at worst it returns "item not found", which is just
  // as informative as "missing field X" for schema-discovery
  // purposes.
  const SAFE_PATH = "/sitecore/content/scai-probe-does-not-exist-DELETE-ME";
  const SAFE_ITEM_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const variants: Array<{ label: string; body: unknown }> = [
    { label: "empty object", body: {} },
    {
      label: "items[] with one safe path",
      body: { items: [{ path: SAFE_PATH }] },
    },
    {
      label: "items[] with safe itemId",
      body: { items: [{ itemId: SAFE_ITEM_ID }] },
    },
    {
      label: "items[] + languages + target",
      body: {
        items: [{ path: SAFE_PATH }],
        languages: ["en"],
        target: "Edge",
      },
    },
    {
      label: "alternate keys: path + republish",
      body: {
        path: SAFE_PATH,
        republish: false,
        languages: ["en"],
        target: "Edge",
      },
    },
    {
      label: "with includeSubitems / includeRelated",
      body: {
        items: [{ path: SAFE_PATH }],
        languages: ["en"],
        target: "Edge",
        includeSubitems: false,
        includeRelated: false,
      },
    },
  ];

  for (const { label, body } of variants) {
    process.stderr.write(`\n> POST ${SUBMIT_URL}\n  variant: ${label}\n`);
    const response = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    process.stdout.write(
      `${JSON.stringify(
        {
          variant: label,
          requestBody: body,
          status: response.status,
          statusText: response.statusText,
          body: text.length > 600 ? text.slice(0, 600) + "…" : text,
        },
        null,
        2
      )}\n\n`
    );
    // If we got a 201/200 we hit a working shape — STOP IMMEDIATELY
    // so we don't accidentally fire a second real publish.
    if (response.status >= 200 && response.status < 300) {
      process.stderr.write(
        `⚠️  Variant '${label}' returned ${response.status} — likely created a real publish job. Stopping further variants.\n`
      );
      break;
    }
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
