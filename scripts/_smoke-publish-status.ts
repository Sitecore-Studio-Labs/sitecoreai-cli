/**
 * Tests `scai publish status` end-to-end using the real
 * `runPublishStatus` task — same code path the CLI invokes.
 *
 * Credentials come from scai's standard env-var pattern:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET
 *
 * (For sandbox, that's SITECOREAI_ENV_SANDBOX_CLIENT_ID and _SECRET.)
 *
 * Usage:
 *   export SITECOREAI_ENV_SANDBOX_CLIENT_ID=<env-level-client-id>
 *   export SITECOREAI_ENV_SANDBOX_CLIENT_SECRET=<env-level-client-secret>
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-status.ts sandbox <jobId>
 *
 * If you don't have a real jobId yet, pass "probe-id" — the Publishing
 * API will return a 404-shaped response which proves the auth path
 * works without requiring a real publish to have happened.
 */
import { runPublishStatus } from "@/publishing/tasks";
import { ScaiError } from "@/shared/errors";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const jobId = process.argv[3] ?? "probe-id";

  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const idVar = `SITECOREAI_ENV_${envSlug}_CLIENT_ID`;
  const secretVar = `SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`;
  process.stderr.write(`> env: ${envName}, jobId: ${jobId}\n`);
  process.stderr.write(
    `> ${idVar}:     ${process.env[idVar] ? `<set, len=${process.env[idVar]!.length}>` : "<NOT SET>"}\n`
  );
  process.stderr.write(
    `> ${secretVar}: ${process.env[secretVar] ? `<set, len=${process.env[secretVar]!.length}>` : "<NOT SET>"}\n`
  );

  try {
    await runPublishStatus({ environmentName: envName, jobId });
  } catch (err) {
    if (err instanceof ScaiError) {
      process.stderr.write(`\nFAIL [${err.code}] ${err.message}\n`);
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
