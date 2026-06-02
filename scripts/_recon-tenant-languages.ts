/**
 * Recon: call the real `AuthoringApiClient.getTenantLanguages` against
 * a live tenant — confirms the production query path returns sensible
 * data on the actual schema.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_recon-tenant-languages.ts [envName]
 */
import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment, timeoutMs } = resolveEnvironment({
    environmentName: envName,
    skipPolicy: true,
  });
  const client = createAuthoringClient({ environment, request: { timeoutMs } });

  const languages = await client.getTenantLanguages();
  console.log(`[recon] getTenantLanguages() on '${envName}':`);
  console.log(JSON.stringify(languages, null, 2));

  // Second call — should be cached (no extra wire round trip).
  const languagesAgain = await client.getTenantLanguages();
  console.log(`\n[recon] second call (cached): ${JSON.stringify(languagesAgain)}`);
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
