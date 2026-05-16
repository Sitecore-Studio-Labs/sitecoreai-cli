/**
 * Disambiguates the "item IDs or locales are incorrect" 400 error by
 * trying small permutations of the request body. Stops on the FIRST
 * variant that gets past 400 — so if a variant succeeds it does fire
 * a real publish job (item id is real). The probe is intentionally
 * incremental so the API tells us which field was the culprit.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-submit-variants.ts <NAME> <real-item-guid>
 */
import { requestClientCredentialsToken } from "@/serialization/api/auth";
import { submitPublishJob } from "@/publishing/api/client";
import type { CreatePublishJobRequest } from "@/publishing/api/types";
import { ScaiError } from "@/shared/errors";

const SCOPES = "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";
const AUTHORITY = "https://auth.sitecorecloud.io";
const AUDIENCE = "https://api.sitecorecloud.io";

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  const itemId = process.argv[3];
  if (!envName || !itemId) {
    process.stderr.write("usage: <envName> <real-item-guid>\n");
    process.exit(2);
  }
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
    process.stderr.write("FAIL: no token\n");
    process.exit(1);
  }
  const client = { accessToken };

  const baseRequest = (
    overrides: Partial<CreatePublishJobRequest> & {
      itemOverrides?: { id?: string; type?: string; locale?: string };
      locales?: string[];
    }
  ): CreatePublishJobRequest => ({
    name: `scai-smoke variant ${new Date().toISOString()}`,
    source: "scai",
    options: {
      items: [
        {
          id: overrides.itemOverrides?.id ?? itemId,
          type: overrides.itemOverrides?.type ?? "item",
          ...(overrides.itemOverrides?.locale ? { locale: overrides.itemOverrides.locale } : {}),
        },
      ],
      xmc: {
        locales: overrides.locales ?? ["en"],
        items: { mode: "Smart", publishChildren: false, publishRelatedItems: false },
      },
    },
    ...overrides,
  });

  const variants: Array<{ label: string; request: CreatePublishJobRequest }> = [
    {
      label: "baseline: type=item, locales=[en]",
      request: baseRequest({}),
    },
    {
      label: "locale=en-US (instead of en)",
      request: baseRequest({ locales: ["en-US"] }),
    },
    {
      label: "no xmc.locales (let tenant default)",
      request: baseRequest({ locales: undefined }) as CreatePublishJobRequest,
    },
    {
      label: "GUID with braces: {…}",
      request: baseRequest({ itemOverrides: { id: `{${itemId}}` } }),
    },
    {
      label: "GUID uppercase, no braces",
      request: baseRequest({ itemOverrides: { id: itemId.toUpperCase() } }),
    },
    {
      label: "GUID without dashes",
      request: baseRequest({ itemOverrides: { id: itemId.replace(/-/g, "") } }),
    },
    {
      label: "type=Item (capitalized)",
      request: baseRequest({ itemOverrides: { type: "Item" } }),
    },
    {
      label: "type=ContentItem",
      request: baseRequest({ itemOverrides: { type: "ContentItem" } }),
    },
    {
      label: "no locales at all, type=item, raw id",
      request: {
        name: `scai-smoke variant-min ${new Date().toISOString()}`,
        source: "scai",
        options: {
          items: [{ id: itemId, type: "item" }],
          xmc: { items: { mode: "Smart" } },
        },
      },
    },
  ];

  for (const { label, request } of variants) {
    process.stderr.write(`\n> trying: ${label}\n`);
    try {
      const job = await submitPublishJob(client, request);
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            variant: label,
            summary: `🎯 SUCCESS — submitting publish triggered job ${job.id}. STOPPING further variants.`,
            job: { id: job.id, state: job.state, name: job.name },
            request,
          },
          null,
          2
        )}\n`
      );
      process.stderr.write(
        `\n⚠️  Real publish job submitted: ${job.id}. Track with:\n  scai publish status ${job.id} -n ${envName}\n`
      );
      return;
    } catch (err) {
      if (err instanceof ScaiError) {
        const detail = err.hint ?? err.message;
        const short = detail.length > 250 ? detail.slice(0, 250) + "…" : detail;
        process.stdout.write(
          `${JSON.stringify({ ok: false, variant: label, hint: short }, null, 2)}\n`
        );
        continue;
      }
      throw err;
    }
  }
  process.stderr.write(
    `\nAll variants returned 400. Item ${itemId} may not exist in this env, or the API expects something unusual.\n`
  );
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
