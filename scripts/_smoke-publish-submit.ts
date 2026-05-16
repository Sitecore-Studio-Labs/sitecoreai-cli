/**
 * End-to-end smoke for `submitPublishJob` — the actual scai client
 * function `scai publish item` uses, wired against the real Publishing
 * API with credentials from env vars. Skips the CLI / config layer
 * (no env profile edit needed) so the smoke can run unconditionally.
 *
 * Body shape uses the canonical schema discovered from the OpenAPI
 * bundle. By default targets a fake item id so the API rejects with
 * "item not found" — proves the entire pipeline (auth + body shape +
 * endpoint + parsing) without firing a real publish.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-submit.ts <NAME> [item-id]
 *
 * To publish a REAL item, pass its GUID as the second arg. Otherwise
 * a clearly-fake id is used so nothing actually gets published.
 */
import { requestClientCredentialsToken } from "@/serialization/api/auth";
import { submitPublishJob } from "@/publishing/api/client";
import type { CreatePublishJobRequest } from "@/publishing/api/types";
import { ScaiError } from "@/shared/errors";

const SCOPES = "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";
const AUTHORITY = "https://auth.sitecorecloud.io";
const AUDIENCE = "https://api.sitecorecloud.io";
const FAKE_ITEM_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "Agents";
  const itemId = process.argv[3] ?? FAKE_ITEM_ID;
  const isFake = itemId === FAKE_ITEM_ID;
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const clientId = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`];
  const clientSecret = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    process.stderr.write(`Set SITECOREAI_ENV_${envSlug}_CLIENT_ID and _CLIENT_SECRET first.\n`);
    process.exit(2);
  }

  process.stderr.write(`> env: ${envName}\n`);
  process.stderr.write(
    `> item id: ${itemId}${isFake ? " (FAKE — no real publish will fire)" : " (REAL — this WILL publish if the API accepts it)"}\n`
  );
  if (!isFake) {
    process.stderr.write(`> ⚠️  this will trigger a REAL publish job on env '${envName}'\n`);
  }

  process.stderr.write(`\n> [1/2] minting token\n`);
  let accessToken: string;
  try {
    const result = await requestClientCredentialsToken(
      { authority: AUTHORITY, clientId, clientSecret, audience: AUDIENCE },
      SCOPES
    );
    if (!result.accessToken) {
      process.stderr.write("FAIL: no token returned\n");
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

  process.stderr.write(
    `\n> [2/2] POST /authoring/publishing/v1/jobs via scai's submitPublishJob\n`
  );
  const request: CreatePublishJobRequest = {
    name: isFake ? `scai-smoke ${new Date().toISOString()}` : `scai-smoke real ${itemId}`,
    source: "scai",
    description: isFake
      ? "Smoke test against fake item id — expected to fail validation."
      : undefined,
    options: {
      items: [{ id: itemId, type: "item" }],
      xmc: {
        locales: ["en"],
        items: {
          mode: "Smart",
          publishChildren: false,
          publishRelatedItems: false,
        },
      },
    },
  };
  process.stderr.write(`> request body:\n${JSON.stringify(request, null, 2)}\n\n`);

  try {
    const job = await submitPublishJob({ accessToken }, request);
    process.stdout.write(
      `${JSON.stringify({ ok: true, job: { id: job.id, state: job.state, name: job.name, canCancel: job.canCancel } }, null, 2)}\n`
    );
    if (!isFake) {
      process.stderr.write(
        `\n✅ Real publish job ${job.id} submitted. Track with: scai publish status ${job.id} -n ${envName}\n`
      );
    } else {
      process.stderr.write(
        `\n⚠️  API accepted a fake item id — that's unexpected. Inspect the response above; the API may not validate item existence at submission time.\n`
      );
    }
  } catch (err) {
    if (err instanceof ScaiError) {
      process.stdout.write(
        `${JSON.stringify(
          { ok: false, code: err.code, message: err.message, hint: err.hint?.slice(0, 600) },
          null,
          2
        )}\n`
      );
      if (isFake && /not found|invalid|does not exist/i.test(err.hint ?? "")) {
        process.stderr.write(
          `\n✅ Expected: API rejected the fake item id. End-to-end pipeline works (auth + body shape + endpoint).\n`
        );
        process.exit(0);
      }
      process.exit(err.exitCode);
    }
    throw err;
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
