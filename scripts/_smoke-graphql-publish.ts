/**
 * Validates the GraphQL-backed publishing path end-to-end:
 *   1. `listOfTargets` — proves auth + endpoint reachable
 *   2. `runPublishStatus` against a fake jobId — proves the CLI task
 *      surfaces a real (non-auth) GraphQL response
 *
 * Both use the existing scai access token (xmcloud.cm:admin).
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-graphql-publish.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { fetchPublishingTargets } from "@/serialization/sitecore-api/publish";
import { runPublishStatus } from "@/publishing/tasks";
import { ScaiError } from "@/shared/errors";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";

  process.stderr.write(`> [1/2] listOfTargets via Authoring GraphQL\n`);
  const { environment } = resolveEnvironment({ environmentName: envName });
  const targets = await fetchPublishingTargets(environment);
  process.stdout.write(
    `${JSON.stringify({ step: "listOfTargets", targets }, null, 2)}\n\n`
  );

  process.stderr.write(`> [2/2] runPublishStatus on a probe jobId\n`);
  try {
    await runPublishStatus({ environmentName: envName, jobId: "smoke-probe-id" });
  } catch (err) {
    if (err instanceof ScaiError) {
      process.stdout.write(
        `${JSON.stringify(
          {
            step: "runPublishStatus",
            outcome: "scai-error",
            code: err.code,
            message: err.message,
            hint: err.hint,
          },
          null,
          2
        )}\n`
      );
      return;
    }
    throw err;
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
