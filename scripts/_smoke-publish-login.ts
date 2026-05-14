/**
 * Runs `scai publish login` directly (bypassing cli.ts so the
 * MCP-SDK ESM issue on this branch doesn't jam the entry point).
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publish-login.ts [envName]
 *
 * Opens a browser for OAuth consent. Stores the resulting publishing
 * token in the OS keychain under a publishing-specific entry; does
 * NOT touch the deploy token.
 */
import { runPublishingLogin } from "@/publishing/tasks";
import { ScaiError } from "@/shared/errors";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  try {
    await runPublishingLogin({ environmentName: envName });
  } catch (error) {
    if (error instanceof ScaiError) {
      process.stderr.write(`FAIL [${error.code}] ${error.message}\n`);
      if (error.hint) {
        process.stderr.write(`HINT  ${error.hint}\n`);
      }
      process.exit(error.exitCode);
    }
    throw error;
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
