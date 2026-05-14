/**
 * Lists Sitecore Cloud Portal "contexts" for the org, using the
 * existing deploy token. Helps figure out what a "context id" actually
 * is in this org and whether the Publishing API needs one.
 *
 * Custom Context API:
 *   GET https://edge-platform.sitecorecloud.io/api/context/user/v2/contexts
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-list-contexts.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { getAccessToken } from "@/serialization/sitecore-api/auth";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const { environment } = resolveEnvironment({ environmentName: envName });
  const token = await getAccessToken(environment);
  if (!token) {
    process.stderr.write("no deploy token — run `scai login` first\n");
    process.exit(1);
  }

  const url = "https://edge-platform.sitecorecloud.io/api/context/user/v2/contexts";
  process.stderr.write(`> GET ${url}\n`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const bodyText = await response.text();
  process.stderr.write(`< ${response.status} ${response.statusText}\n`);
  process.stdout.write(`${bodyText}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
