/**
 * Exercises the full option surface of the Publishing API end-to-end.
 * Submits real jobs against the configured env; prints job ids so
 * the operator can cancel any they don't want to complete.
 *
 * Coverage map:
 *   T1.A  Smart mode, single item                  (baseline, already proven)
 *   T1.B  Republish mode, single item
 *   T1.C  Smart + publishChildren (subtree)
 *   T1.D  Smart + publishRelatedItems
 *   T1.E  Smart + publishChildren + publishRelatedItems
 *   T1.F  Multi-item batch (2+ items in one job)
 *   T1.G  Multi-locale batch
 *   T2.A  publish all, mode: Smart (tenant-wide, least invasive)
 *   T2.B  publish all, mode: Incremental
 *
 * Skipped on purpose:
 *   - publish all, mode: Republish — fires a true whole-tenant
 *     re-emit. Run by hand when actually wanted.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-coverage.ts <NAME> <item-guid-1> [item-guid-2]
 */
import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import { submitPublishJob } from "@/publishing/sitecore-api/client";
import type { CreatePublishJobRequest } from "@/publishing/sitecore-api/types";
import { ScaiError } from "@/shared/errors";

const SCOPES = "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  const item1 = process.argv[3];
  const item2 = process.argv[4];
  if (!envName || !item1) {
    process.stderr.write("usage: <envName> <item-guid-1> [item-guid-2]\n");
    process.exit(2);
  }
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const t = await requestClientCredentialsToken(
    {
      authority: "https://auth.sitecorecloud.io",
      clientId: process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`],
      clientSecret: process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`],
      audience: "https://api.sitecorecloud.io",
    },
    SCOPES
  );
  const client = { accessToken: t.accessToken! };

  const cases: Array<{ label: string; request: CreatePublishJobRequest }> = [
    {
      label: "T1.B Republish mode, single item",
      request: {
        name: "scai-coverage T1.B Republish single",
        source: "scai-coverage",
        options: {
          items: [{ id: item1, type: "item" }],
          xmc: { locales: ["en"], items: { mode: "Republish" } },
        },
      },
    },
    {
      label: "T1.C Smart + publishChildren (subtree)",
      request: {
        name: "scai-coverage T1.C subtree",
        source: "scai-coverage",
        options: {
          items: [{ id: item1, type: "item" }],
          xmc: { locales: ["en"], items: { mode: "Smart", publishChildren: true } },
        },
      },
    },
    {
      label: "T1.D Smart + publishRelatedItems",
      request: {
        name: "scai-coverage T1.D related",
        source: "scai-coverage",
        options: {
          items: [{ id: item1, type: "item" }],
          xmc: { locales: ["en"], items: { mode: "Smart", publishRelatedItems: true } },
        },
      },
    },
    {
      label: "T1.E Smart + publishChildren + publishRelatedItems",
      request: {
        name: "scai-coverage T1.E subtree+related",
        source: "scai-coverage",
        options: {
          items: [{ id: item1, type: "item" }],
          xmc: {
            locales: ["en"],
            items: { mode: "Smart", publishChildren: true, publishRelatedItems: true },
          },
        },
      },
    },
    ...(item2
      ? [
          {
            label: "T1.F Multi-item batch (2 items)",
            request: {
              name: "scai-coverage T1.F multi-item",
              source: "scai-coverage",
              options: {
                items: [
                  { id: item1, type: "item" },
                  { id: item2, type: "item" },
                ],
                xmc: { locales: ["en"], items: { mode: "Smart" } },
              },
            } as CreatePublishJobRequest,
          },
        ]
      : []),
    {
      label: "T1.G Multi-locale batch",
      request: {
        name: "scai-coverage T1.G multi-locale",
        source: "scai-coverage",
        options: {
          items: [{ id: item1, type: "item" }],
          xmc: { locales: ["en", "de", "fr"], items: { mode: "Smart" } },
        },
      },
    },
    // Tier 2 (publish all) variants intentionally skipped here — they
    // fire whole-tenant operations. Run scripts/_smoke-publish-submit.ts
    // by hand against `xmc.site` when you actually want to exercise
    // them.
  ];

  const results: Array<{ label: string; outcome: string; jobId?: string; hint?: string }> = [];
  for (const { label, request } of cases) {
    process.stderr.write(`\n> ${label}\n`);
    try {
      const job = await submitPublishJob(client, request);
      results.push({ label, outcome: "submitted", jobId: job.id });
      process.stderr.write(`  ✅ job ${job.id} (${job.state})\n`);
    } catch (err) {
      if (err instanceof ScaiError) {
        const hint = err.hint?.slice(0, 200) ?? err.message.slice(0, 200);
        results.push({ label, outcome: `error: ${err.code}`, hint });
        process.stderr.write(`  ❌ [${err.code}] ${hint}\n`);
        continue;
      }
      throw err;
    }
  }

  process.stdout.write(`\n${JSON.stringify({ summary: results }, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
