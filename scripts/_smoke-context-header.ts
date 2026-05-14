/**
 * Probes the Publishing API with the existing CM access token, trying
 * a list of plausible context-id header / path / query variants.
 * Whichever returns 200 (instead of 403) reveals the consumption
 * pattern for the per-env `liveContextId`.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-context-header.ts <liveContextId> [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { getAccessToken } from "@/serialization/sitecore-api/auth";

const BASE = "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs";

const candidates: Array<{ label: string; url: string; headers: Record<string, string> }> = [];

const main = async (): Promise<void> => {
  const contextId = process.argv[2];
  const envName = process.argv[3] ?? "sandbox";
  if (!contextId) {
    process.stderr.write("usage: <liveContextId> [envName]\n");
    process.exit(2);
  }
  const { environment } = resolveEnvironment({ environmentName: envName });
  const token = await getAccessToken(environment);
  if (!token) {
    process.stderr.write("no token\n");
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  candidates.push(
    { label: "Header: sc_apikey", url: BASE, headers: { ...auth, sc_apikey: contextId } },
    { label: "Header: X-Sitecore-Context", url: BASE, headers: { ...auth, "X-Sitecore-Context": contextId } },
    { label: "Header: X-Sitecore-Context-Id", url: BASE, headers: { ...auth, "X-Sitecore-Context-Id": contextId } },
    { label: "Header: X-Sitecore-ContextId", url: BASE, headers: { ...auth, "X-Sitecore-ContextId": contextId } },
    { label: "Header: X-Context-Id", url: BASE, headers: { ...auth, "X-Context-Id": contextId } },
    { label: "Header: X-Edge-Context", url: BASE, headers: { ...auth, "X-Edge-Context": contextId } },
    { label: "Header: context-id", url: BASE, headers: { ...auth, "context-id": contextId } },
    { label: "Query: ?contextId=", url: `${BASE}?contextId=${contextId}`, headers: auth },
    { label: "Query: ?context_id=", url: `${BASE}?context_id=${contextId}`, headers: auth },
    { label: "Query: ?sitecoreContextId=", url: `${BASE}?sitecoreContextId=${contextId}`, headers: auth },
    { label: "Header: X-GQL-Token", url: BASE, headers: { ...auth, "X-GQL-Token": contextId } }
  );

  for (const { label, url, headers } of candidates) {
    try {
      const response = await fetch(url, { headers });
      const body = await response.text();
      const snippet = body.length > 120 ? body.slice(0, 120) + "…" : body;
      process.stdout.write(`[${response.status}] ${label}\n    ${snippet || "(empty body)"}\n\n`);
    } catch (err) {
      process.stdout.write(
        `[ERR] ${label}\n    ${err instanceof Error ? err.message : String(err)}\n\n`
      );
    }
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
