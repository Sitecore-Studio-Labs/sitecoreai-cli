/**
 * Calls the deploy API's `obtain-edge-token` endpoint for an env to
 * see what context/identifier fields the response carries. Per the
 * operator hint, this is where the "context id" needed for the
 * Publishing API comes from.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-edge-token.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { getDeployToken } from "@/shared/keychain";
import {
  fetchAllEnvironments,
  fetchEnvironmentEdgeToken,
} from "@/deploy/api/environments";
import type { DeployEnvironment } from "@/deploy/api/common";
import { runDeployToken } from "@/serialization/tasks";

const DEPLOY_API_BASE = "https://xmclouddeploy-api.sitecorecloud.io";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const { environment } = resolveEnvironment({ environmentName: envName });
  let token = await getDeployToken(envName);
  if (!token) {
    process.stderr.write(
      `> no deploy token for '${envName}' — running scai login interactively (browser opens)\n`
    );
    await runDeployToken({ environmentName: envName });
    token = await getDeployToken(envName);
    if (!token) {
      process.stderr.write(`deploy login produced no token\n`);
      process.exit(1);
    }
  }
  const client = { accessToken: token, baseUrl: DEPLOY_API_BASE };

  // Resolve environmentId: prefer env profile, else look up by host.
  let environmentId = environment.environmentId;
  if (!environmentId) {
    process.stderr.write(`> resolving environmentId from host '${environment.host}'\n`);
    const all = await fetchAllEnvironments(client);
    const match = all.items.find((e: DeployEnvironment) => e.host === environment.host);
    environmentId = match?.environmentId ?? match?.id;
    if (!environmentId) {
      process.stderr.write(`could not find environment matching host '${environment.host}'\n`);
      process.exit(1);
    }
  }
  process.stderr.write(`> environmentId: ${environmentId}\n`);
  process.stderr.write(`> POST .../obtain-edge-token (returns shape with token + context)\n`);

  const result = await fetchEnvironmentEdgeToken(client, environmentId);
  // Print full response so we see every field including context ids.
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
