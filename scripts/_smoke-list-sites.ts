/**
 * Lists sites for an environment via the Sites API and dumps the raw
 * response so we can see what context-id-shaped fields are populated
 * (properties, settings, hosts, id).
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-list-sites.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { getAccessToken } from "@/serialization/sitecore-api/auth";
import { listSites } from "@/sites/api/sites";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const { environment } = resolveEnvironment({ environmentName: envName });
  const token = await getAccessToken(environment);
  if (!token) {
    process.stderr.write(`no CM access token for env '${envName}'\n`);
    process.exit(1);
  }
  process.stderr.write(`> Sites API at https://xmapps-api.sitecorecloud.io/api/v1/sites\n`);
  const sites = await listSites({ accessToken: token });
  process.stdout.write(`${JSON.stringify(sites, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
