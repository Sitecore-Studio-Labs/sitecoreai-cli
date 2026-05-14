/**
 * Probes multiple plausible hosts/paths for the Sitecore Custom Context
 * API to figure out where it actually lives. Used to chase the
 * "context id" question for the Publishing API. Read-only probe.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-context-probe.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { getAccessToken } from "@/serialization/sitecore-api/auth";

const CANDIDATES = [
  "https://edge-platform.sitecorecloud.io/api/context/user/v1/contexts",
  "https://edge-platform.sitecorecloud.io/api/context/user/v2/contexts",
  "https://edge-platform.sitecorecloud.io/api/context/v1/contexts",
  "https://edge-platform.sitecorecloud.io/api/v1/contexts",
  "https://portal.sitecorecloud.io/api/context/user/v1/contexts",
  "https://portal.sitecorecloud.io/api/context/user/v2/contexts",
];

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const { environment } = resolveEnvironment({ environmentName: envName });
  const token = await getAccessToken(environment);
  if (!token) {
    process.stderr.write("no deploy token\n");
    process.exit(1);
  }

  for (const url of CANDIDATES) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const body = await response.text();
      const preview = body.length > 200 ? body.slice(0, 200) + "…" : body;
      process.stdout.write(`[${response.status}] ${url}\n    ${preview}\n\n`);
    } catch (err) {
      process.stdout.write(
        `[ERR] ${url}\n    ${err instanceof Error ? err.message : String(err)}\n\n`
      );
    }
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
