/**
 * Lifecycle smoke against a known job id — get, cancel, get again.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-lifecycle.ts <NAME> <jobId>
 */
import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import {
  cancelPublishJob,
  getPublishJob,
  listPublishJobs,
} from "@/publishing/sitecore-api/client";

const SCOPES = "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "Agents";
  const jobId = process.argv[3];
  if (!jobId) {
    process.stderr.write("usage: <envName> <jobId>\n");
    process.exit(2);
  }
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const id = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`];
  const secret = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`];
  if (!id || !secret) {
    process.stderr.write(`Set SITECOREAI_ENV_${envSlug}_CLIENT_ID/_SECRET\n`);
    process.exit(2);
  }
  const t = await requestClientCredentialsToken(
    {
      authority: "https://auth.sitecorecloud.io",
      clientId: id,
      clientSecret: secret,
      audience: "https://api.sitecorecloud.io",
    },
    SCOPES
  );
  const client = { accessToken: t.accessToken! };

  process.stderr.write(`> [1/4] listPublishJobs\n`);
  const list1 = await listPublishJobs(client, { pageSize: 5 });
  process.stdout.write(
    `${JSON.stringify({ step: "list", count: list1.length, jobs: list1.map((j) => ({ id: j.id, state: j.state })) }, null, 2)}\n\n`
  );

  process.stderr.write(`> [2/4] getPublishJob ${jobId}\n`);
  const job1 = await getPublishJob(client, jobId);
  process.stdout.write(
    `${JSON.stringify({ step: "get-before", id: job1.id, state: job1.state, canCancel: job1.canCancel, processedCount: job1.processedCount, startedAt: job1.startedAt, completedAt: job1.completedAt }, null, 2)}\n\n`
  );

  if (!job1.canCancel) {
    process.stderr.write(`\n⚠️  Job state '${job1.state}' is not cancellable. Skipping cancel step.\n`);
    return;
  }

  process.stderr.write(`> [3/4] cancelPublishJob ${jobId}\n`);
  await cancelPublishJob(client, jobId);
  process.stdout.write(
    `${JSON.stringify({ step: "cancel", outcome: "202 accepted" }, null, 2)}\n\n`
  );

  // Small wait so the API can transition state from Canceling to Canceled
  await new Promise((resolve) => setTimeout(resolve, 1500));

  process.stderr.write(`> [4/4] getPublishJob ${jobId} (post-cancel)\n`);
  const job2 = await getPublishJob(client, jobId);
  process.stdout.write(
    `${JSON.stringify({ step: "get-after", id: job2.id, state: job2.state, canCancel: job2.canCancel, raw_status: job2.raw.system.status, canceledBy: job2.raw.system.canceledBy }, null, 2)}\n`
  );
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
