/**
 * One-shot smoke test for `scai publish status` — imports the publishing
 * library directly to bypass cli.ts (which on this branch fails at import
 * time because of unrelated WIP). Not checked in to the user-facing
 * surface; prefix `_` marks it as a dev-only ad hoc script.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-status.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { acquirePublishingToken } from "@/publishing/sitecore-api/auth";
import { listPublishJobs } from "@/publishing/sitecore-api/client";
import { ScaiError } from "@/shared/errors";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  process.stderr.write(`> resolving env '${envName}'\n`);
  const { environment } = resolveEnvironment({ environmentName: envName });
  process.stderr.write(`> requesting publishing-scoped token (xmcpub.jobs.a:r/w xmcpub.queue:r)\n`);
  const accessToken = await acquirePublishingToken(environment);
  process.stderr.write(`> GET /authoring/publishing/v1/jobs\n`);
  try {
    const jobs = await listPublishJobs({ accessToken });
    process.stdout.write(`${JSON.stringify(jobs, null, 2)}\n`);
  } catch (err) {
    if (err instanceof ScaiError) {
      process.stderr.write(`FAIL [${err.code}] ${err.message}\n`);
      if (err.hint) {
        process.stderr.write(`HINT  ${err.hint}\n`);
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
