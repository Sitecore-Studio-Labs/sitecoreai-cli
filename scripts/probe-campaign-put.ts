/**
 * One-off probe: does the Sitecore Orchestrate API support the update
 * verbs scai never exercised — a full `PUT /projects/{id}` (the brief-style
 * full-replace) and a deliverable `PUT` / `GET`?
 *
 * SAFE: creates a clearly-named THROWAWAY project, probes against it only,
 * and deletes it at the end. It never touches a real campaign.
 *
 * Run (after `scai setup login -n <env>`):
 *   pnpm tsx -r tsconfig-paths/register scripts/probe-campaign-put.ts
 *
 * Env overrides: SCAI_PROBE_ENV (default: config's default env).
 */
import { resolveCampaignClient } from "@/campaigns/recipe/client";
import {
  campaignRequest,
  createDeliverable,
  createProject,
  createTask,
  deleteProject,
  getProject,
} from "@/campaigns";
import { readRootConfiguration } from "@/config/root-config";
import type { Logger } from "@/shared/logger";

const log = (...args: unknown[]) => console.log(...args);
const stamp = Date.now();
const PROBE_NAME = `zzz-PROBE-DELETE-ME-${stamp}`;

// A tiny `SyncContext`-shaped object — only configPath + environmentName
// are read by `resolveCampaignClient`.
const configPath = process.cwd();
const root = readRootConfiguration(configPath);
const environmentName = process.env.SCAI_PROBE_ENV ?? root.defaultEnvironment;

/** Run an HTTP verb via campaignRequest, returning {ok, status, body|error}. */
const tryRequest = async (
  client: { accessToken: string; baseUrl?: string },
  label: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<void> => {
  try {
    const res = await campaignRequest<unknown>(client, path, init as never);
    log(`  ✅ ${label}: SUCCESS — server accepted ${init.method} ${path}`);
    log(`     response: ${JSON.stringify(res).slice(0, 400)}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`  ❌ ${label}: REJECTED — ${msg.slice(0, 300)}`);
  }
};

const run = async () => {
  log(`\n=== Campaign API update-verb probe (env: ${environmentName}) ===\n`);
  const client = await resolveCampaignClient({
    configPath,
    environmentName,
    logger: { info: () => {}, warn: () => {} } as unknown as Logger,
  });

  // 1. Create a throwaway project + deliverable + task.
  log(`Creating throwaway project "${PROBE_NAME}"…`);
  const project = await createProject(client, {
    name: PROBE_NAME,
    status: "NOT_STARTED",
    start_date: "2026-06-01",
    due_date: "2026-12-01",
    labels: ["probe:delete-me"],
  });
  log(`  created project id=${project.id}`);
  let deliverableId: string | undefined;
  try {
    const deliverable = await createDeliverable(client, project.id, {
      name: `${PROBE_NAME}-deliverable`,
      status: "NOT_STARTED",
      funnel_stage: "TOP",
      due_date: "2026-11-01",
    } as never);
    deliverableId = deliverable.id;
    log(`  created deliverable id=${deliverableId}`);
    try {
      const task = await createTask(client, project.id, deliverableId, {
        name: `${PROBE_NAME}-task`,
        status: "NOT_STARTED",
        due_date: "2026-10-01",
      } as never);
      log(`  created task id=${task.id}`);
    } catch (e) {
      log(`  (task create failed: ${e instanceof Error ? e.message : String(e)})`);
    }
  } catch (e) {
    log(`  (deliverable create failed: ${e instanceof Error ? e.message : String(e)})`);
  }

  // 2. Re-read the full inline tree (what a full PUT body would mirror).
  const full = await getProject(client, project.id);
  log(`\nFull project tree on GET: ${JSON.stringify(full).slice(0, 500)}…\n`);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tree = full as any;

  // 3. PROBE A — full-replace PUT on the project, mutating a NESTED task's
  //    due_date to test whether the PUT cascades to children.
  log("Probe A — full project PUT, mutating project.description AND a nested task.due_date:");
  const mutated = JSON.parse(JSON.stringify(tree));
  mutated.description = "probe full-replace edit";
  const firstTask = mutated?.deliverables?.[0]?.tasks?.[0];
  const taskDueBefore = firstTask?.due_date;
  if (firstTask) firstTask.due_date = "2099-01-01T10:00:00Z";
  await tryRequest(client, "project full PUT", `/api/orchestrate/v1/projects/${project.id}`, {
    method: "PUT",
    body: mutated,
  });
  const afterA = (await getProject(client, project.id)) as any;
  log(
    `  cascade check: nested task.due_date ${JSON.stringify(taskDueBefore)} -> ${JSON.stringify(afterA?.deliverables?.[0]?.tasks?.[0]?.due_date)} (==2099 ⇒ full PUT CASCADES to tasks; one-call sync possible)`,
  );

  // 4. PROBE B — deliverable PUT with the FULL required body.
  if (deliverableId) {
    log("\nProbe B — deliverable PUT with full body:");
    await tryRequest(
      client,
      "deliverable PUT (full body)",
      `/api/orchestrate/v1/projects/${project.id}/deliverables/${deliverableId}`,
      {
        method: "PUT",
        body: {
          project_id: project.id,
          name: `${PROBE_NAME}-deliverable`,
          due_date: "2026-11-01",
          status: "IN_PROGRESS",
          funnel_stage: "TOP",
        },
      },
    );
    const afterB = (await getProject(client, project.id)) as any;
    log(
      `  deliverable.status after PUT: ${JSON.stringify(afterB?.deliverables?.[0]?.status)} (==IN_PROGRESS ⇒ deliverable PUT works)`,
    );
  }

  // 6. Clean up.
  log(`\nDeleting throwaway project ${project.id}…`);
  try {
    await deleteProject(client, project.id);
    log("  deleted.");
  } catch (e) {
    log(
      `  ⚠️ delete failed — REMOVE MANUALLY: project "${PROBE_NAME}" (id ${project.id}). ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  log("\n=== Done ===\n");
};

run().catch((error) => {
  console.error("Probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
