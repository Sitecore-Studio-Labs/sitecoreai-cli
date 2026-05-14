/**
 * Dumps the FULL Deploy API response for an environment — bypasses
 * scai's typed `DeployEnvironment` shape, which only surfaces a subset
 * of fields. We're looking for `contextId` / `sitecoreContextId` /
 * any GUID-shaped field that maps to the Pages JWT's tenant claims.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-env-raw.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { getDeployToken } from "@/shared/keychain";
import { fetchAllEnvironments } from "@/deploy/api/environments";
import { deployRequest } from "@/deploy/api/common";
import type { DeployEnvironment } from "@/deploy/api/common";
import { runDeployToken } from "@/serialization/tasks";

const DEPLOY_API_BASE = "https://xmclouddeploy-api.sitecorecloud.io";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const { environment } = resolveEnvironment({ environmentName: envName });
  let token = await getDeployToken(envName);
  if (!token) {
    process.stderr.write(`> no deploy token — running scai login (browser opens)\n`);
    await runDeployToken({ environmentName: envName });
    token = await getDeployToken(envName);
    if (!token) {
      process.stderr.write(`login produced no token\n`);
      process.exit(1);
    }
  }
  const client = { accessToken: token, baseUrl: DEPLOY_API_BASE };

  let environmentId = environment.environmentId;
  if (!environmentId) {
    process.stderr.write(`> resolving environmentId from host '${environment.host}'\n`);
    const all = await fetchAllEnvironments(client);
    const match = all.items.find((e: DeployEnvironment) => e.host === environment.host);
    environmentId = match?.environmentId ?? match?.id;
    if (!environmentId) {
      process.stderr.write(`could not find environment\n`);
      process.exit(1);
    }
  }
  process.stderr.write(`> environmentId: ${environmentId}\n`);
  process.stderr.write(`> GET /api/environments/v2/${environmentId} (raw response)\n`);

  // Use deployRequest directly with `unknown` so we capture EVERY field.
  const raw = await deployRequest<unknown>(
    client,
    `/api/environments/v2/${environmentId}`
  );
  process.stdout.write(`${JSON.stringify(raw, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
