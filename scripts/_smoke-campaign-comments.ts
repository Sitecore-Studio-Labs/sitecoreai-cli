/**
 * Campaign comments discovery probe.
 *
 * The Orchestrate API surface scai re-implements has no comments
 * helper — the HAR capture never exercised one, so it is unknown
 * whether project-level comments / notes are even reachable, and at
 * which path. This probe is READ-ONLY recon: it confirms the env's M2M
 * client can reach the Orchestrate API, then GET-probes a set of
 * candidate comment endpoints and reports each status code.
 *
 * It NEVER POSTs — discovery only. A 200 means the path exists and is
 * readable; a 404 rules it out; a 401/403 means the path may exist but
 * the token lacks scope; a 405 means the path exists but GET is not the
 * verb.
 *
 * Candidate endpoints probed (given a project id):
 *   - GET /api/orchestrate/v1/projects/{id}/comments      (sub-resource)
 *   - GET /api/orchestrate/v1/comments?ProjectId={id}     (filtered collection)
 *   - GET /api/orchestrate/v1/projects/{id}/notes         (alt noun)
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-campaign-comments.ts agents [projectId]
 *
 * If `projectId` is omitted the probe lists projects and uses the first.
 */
import { acquireCampaignToken } from "@/campaigns";
import { CAMPAIGN_API_HOST_TEMPLATE } from "@/campaigns/api/types";
import { readRootConfiguration } from "@/config/root-config";
import { resolveRegionalBaseUrl } from "@/shared/region";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "agents";
  const argProjectId = process.argv[3];
  const root = readRootConfiguration("./sitecoreai.cli.json", envName);
  const environment = root.environments[envName];
  if (!environment) {
    process.stderr.write(`Env profile '${envName}' not in sitecoreai.cli.json\n`);
    process.exit(2);
  }

  process.stderr.write(`> acquiring campaign token for '${envName}'\n`);
  let token: string;
  try {
    token = await acquireCampaignToken({ envName, environment });
  } catch (error) {
    process.stderr.write(`> token mint FAILED: ${String(error)}\n`);
    process.stderr.write("> The env's M2M client may not be authorized for the Orchestrate API.\n");
    process.exit(1);
    return;
  }
  process.stderr.write(`> token len=${token.length}\n`);

  // Region-resolve the host the same way the CLI runners do.
  const baseUrl = await resolveRegionalBaseUrl({
    hostTemplate: CAMPAIGN_API_HOST_TEMPLATE,
    organizationId: environment.organizationId,
    override: (environment as unknown as { campaignBaseUrl?: string }).campaignBaseUrl,
    acquireToken: async () => token,
  });
  process.stderr.write(`> base=${baseUrl}\n`);

  const hit = async (
    method: string,
    path: string
  ): Promise<{
    method: string;
    path: string;
    status: number;
    allow: string | null;
    body: string;
  }> => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await response.text();
    process.stderr.write(
      `  ${response.status.toString().padStart(3)} ${method.padEnd(7)} ${path}\n`
    );
    return {
      method,
      path,
      status: response.status,
      allow: response.headers.get("allow"),
      body: text.length > 300 ? `${text.slice(0, 300)}…` : text,
    };
  };

  const records: unknown[] = [];

  // 1. Resolve a project id — caller-supplied, or first from the list.
  let projectId = argProjectId;
  if (!projectId) {
    const list = await hit("GET", "/api/orchestrate/v1/projects?pageNumber=1&pageSize=5");
    records.push(list);
    try {
      const parsed = JSON.parse(list.body.replace(/…$/, "")) as { data?: Array<{ id: string }> };
      projectId = parsed.data?.[0]?.id;
    } catch {
      /* body truncated or non-JSON */
    }
  }

  // 2. GET-probe candidate comment endpoints. READ-ONLY — never POST.
  if (projectId) {
    records.push(await hit("GET", `/api/orchestrate/v1/projects/${projectId}/comments`));
    records.push(
      await hit("GET", `/api/orchestrate/v1/comments?ProjectId=${encodeURIComponent(projectId)}`)
    );
    records.push(await hit("GET", `/api/orchestrate/v1/projects/${projectId}/notes`));
  } else {
    process.stderr.write("> no project id available — pass one as argv[3] or create one first\n");
  }

  process.stdout.write(`${JSON.stringify({ envName, projectId, records }, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
