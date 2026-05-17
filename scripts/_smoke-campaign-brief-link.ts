/**
 * Brief→campaign link discovery probe.
 *
 * The campaign HAR never captured a brief being linked, so the
 * mechanism is unknown. This probe is READ-ONLY recon: it confirms the
 * env's M2M client can reach the Orchestrate API, then OPTIONS-probes
 * the project item route and a candidate `/briefs` sub-resource to
 * learn the allowed verbs — without mutating anything.
 *
 * Hypotheses to disambiguate:
 *   - link via `POST /projects/{id}/briefs`        (sub-resource)
 *   - link via `PATCH/PUT /projects/{id}` { briefs } (field on the project)
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-campaign-brief-link.ts agents
 */
import { acquireCampaignToken } from "@/campaigns";
import { DEFAULT_CAMPAIGN_API_BASE } from "@/campaigns/api/types";
import { readRootConfiguration } from "@/config/root-config";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "agents";
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
    const response = await fetch(`${DEFAULT_CAMPAIGN_API_BASE}${path}`, {
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

  // 1. Auth + list — grab an existing project id to OPTIONS-probe.
  const list = await hit("GET", "/api/orchestrate/v1/projects?pageNumber=1&pageSize=5");
  records.push(list);
  let projectId: string | undefined;
  try {
    const parsed = JSON.parse(list.body.replace(/…$/, "")) as { data?: Array<{ id: string }> };
    projectId = parsed.data?.[0]?.id;
  } catch {
    /* body truncated or non-JSON */
  }

  // 2. OPTIONS recon — project item + candidate brief sub-resources.
  if (projectId) {
    records.push(await hit("OPTIONS", `/api/orchestrate/v1/projects/${projectId}`));
    records.push(await hit("OPTIONS", `/api/orchestrate/v1/projects/${projectId}/briefs`));
    records.push(await hit("GET", `/api/orchestrate/v1/projects/${projectId}/briefs`));
  } else {
    process.stderr.write("> no existing project to OPTIONS-probe — create one first\n");
  }
  records.push(await hit("OPTIONS", "/api/orchestrate/v1/projects"));

  process.stdout.write(`${JSON.stringify({ envName, projectId, records }, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
