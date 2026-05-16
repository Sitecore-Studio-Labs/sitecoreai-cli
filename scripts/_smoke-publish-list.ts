/**
 * Quick smoke for listPublishJobs + getPublishJob against the live
 * API, using env-var credentials.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-list.ts <NAME>
 */
import { requestClientCredentialsToken } from "@/serialization/api/auth";
import { getPublishJob, listPublishJobs } from "@/publishing/api/client";

const SCOPES = "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";
const AUTHORITY = "https://auth.sitecorecloud.io";
const AUDIENCE = "https://api.sitecorecloud.io";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "Agents";
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const clientId = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`];
  const clientSecret = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    process.stderr.write(`Set SITECOREAI_ENV_${envSlug}_CLIENT_ID/_SECRET first.\n`);
    process.exit(2);
  }

  const t = await requestClientCredentialsToken(
    { authority: AUTHORITY, clientId, clientSecret, audience: AUDIENCE },
    SCOPES
  );
  const client = { accessToken: t.accessToken! };

  process.stderr.write(`> [1/2] listPublishJobs (no filter, pageSize 10)\n`);
  const all = await listPublishJobs(client, { pageSize: 10 });
  process.stdout.write(
    `${JSON.stringify({ count: all.length, jobs: all.map((j) => ({ id: j.id, state: j.state, name: j.name, source: j.source, started: j.startedAt, finished: j.completedAt })) }, null, 2)}\n`
  );

  if (all.length === 0) {
    process.stderr.write(`\nNo existing jobs to test getPublishJob against. Done.\n`);
    return;
  }

  const first = all[0];
  process.stderr.write(`\n> [2/2] getPublishJob ${first.id}\n`);
  const fetched = await getPublishJob(client, first.id);
  process.stdout.write(
    `${JSON.stringify(
      {
        id: fetched.id,
        state: fetched.state,
        canCancel: fetched.canCancel,
        processedCount: fetched.processedCount,
        totalCount: fetched.totalCount,
        raw_status: fetched.raw.system.status,
        raw_tenantId: fetched.raw.system.tenantId,
      },
      null,
      2
    )}\n`
  );
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
