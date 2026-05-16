/**
 * Live smoke for the path → itemId resolver. Reads env config the same
 * way `scai publish item` does (via resolveEnvironment), so it picks
 * up host + cached tokens from the operator's normal scai setup.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-path-resolve.ts <envName> <path1> [path2 …]
 *
 * Example: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-path-resolve.ts sandbox /sitecore/content
 */
import { resolveItemPathsToIds } from "@/publishing/api/path-resolver";
import { resolveEnvironment } from "@/shared/env";

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  const paths = process.argv.slice(3);
  if (!envName || paths.length === 0) {
    process.stderr.write("usage: <env> <path1> [path2 …]\n");
    process.exit(2);
  }
  const { environment } = resolveEnvironment({ environmentName: envName });
  const result = await resolveItemPathsToIds(environment, paths);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(99);
});
