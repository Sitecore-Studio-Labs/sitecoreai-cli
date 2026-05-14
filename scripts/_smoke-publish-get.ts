import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import { getPublishJob } from "@/publishing/sitecore-api/client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "Agents";
  const jobId = process.argv[3];
  if (!jobId) {
    process.stderr.write("usage: <env> <jobId>\n");
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
    "xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r"
  );
  const job = await getPublishJob({ accessToken: t.accessToken! }, jobId);
  process.stdout.write(
    `${JSON.stringify(
      {
        state: job.state,
        canCancel: job.canCancel,
        processedCount: job.processedCount,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        raw_status: job.raw.system.status,
        raw_canceledBy: job.raw.system.canceledBy,
        raw_finishTime: job.raw.system.finishTime,
        raw_statistics: job.raw.statistics,
      },
      null,
      2
    )}\n`
  );
};

main().catch((e) => {
  process.stderr.write(`${String(e)}\n`);
  process.exit(99);
});
