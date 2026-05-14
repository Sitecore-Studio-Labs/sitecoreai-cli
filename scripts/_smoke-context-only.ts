/**
 * Probes the Publishing API using the context_id as the SOLE auth —
 * no JWT. Sitecore Edge APIs sometimes use `sc_apikey`-style auth
 * where the context_id IS the credential rather than a scope-bound
 * Bearer JWT. Worth ruling out before declaring scope-grant the only
 * path forward.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-context-only.ts <contextId>
 */
const BASE = "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs";

const main = async (): Promise<void> => {
  const contextId = process.argv[2];
  if (!contextId) {
    process.stderr.write("usage: <contextId>\n");
    process.exit(2);
  }
  const json = { Accept: "application/json" };
  const variants: Array<{ label: string; url: string; headers: Record<string, string> }> = [
    { label: "Bearer <contextId>", url: BASE, headers: { ...json, Authorization: `Bearer ${contextId}` } },
    { label: "Header: sc_apikey ONLY", url: BASE, headers: { ...json, sc_apikey: contextId } },
    { label: "Header: X-Sitecore-Context ONLY", url: BASE, headers: { ...json, "X-Sitecore-Context": contextId } },
    { label: "Header: X-Sitecore-Context-Id ONLY", url: BASE, headers: { ...json, "X-Sitecore-Context-Id": contextId } },
    { label: "Header: X-Context-Id ONLY", url: BASE, headers: { ...json, "X-Context-Id": contextId } },
    { label: "Query: ?sc_apikey=", url: `${BASE}?sc_apikey=${contextId}`, headers: json },
    { label: "Query: ?contextId=", url: `${BASE}?contextId=${contextId}`, headers: json },
    { label: "No auth at all", url: BASE, headers: json },
  ];

  for (const { label, url, headers } of variants) {
    try {
      const response = await fetch(url, { headers });
      const body = await response.text();
      const wwwAuth = response.headers.get("www-authenticate");
      const snippet = body.length > 200 ? body.slice(0, 200) + "…" : body;
      process.stdout.write(
        `[${response.status}] ${label}\n` +
          (wwwAuth ? `    WWW-Authenticate: ${wwwAuth}\n` : "") +
          `    ${snippet || "(empty body)"}\n\n`
      );
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
