/**
 * Campaign DELETE write-contract probe.
 *
 * The Orchestrate API DELETE endpoints for projects, deliverables, and
 * tasks were never captured during reverse-engineering. The SDK helpers
 * `deleteProject` / `deleteDeliverable` / `deleteTask` are wired
 * OPTIMISTICALLY per REST conventions — this script is what verifies
 * them end-to-end.
 *
 * Sequence (self-cleaning — every resource it creates, it deletes):
 *   1. acquire a campaign token for the env
 *   2. create a throwaway project
 *   3. create a deliverable under it
 *   4. create a task under the deliverable
 *   5. DELETE the task        — record status / outcome
 *   6. DELETE the deliverable — record status / outcome
 *   7. DELETE the project     — record status / outcome
 *
 * Steps 5–7 are the contract under test. If a DELETE fails the script
 * still attempts the remaining cleanup so it does not leak resources;
 * if create fails before a resource exists, that resource's delete is
 * skipped.
 *
 * Output is JSON to stdout (one record per step) and a human log to
 * stderr.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-campaign-delete.ts agents
 */
import {
  createDeliverable,
  createProject,
  createTask,
  deleteDeliverable,
  deleteProject,
  deleteTask,
  resolveCampaignClient,
} from "@/campaigns";

type StepRecord = {
  step: string;
  ok: boolean;
  detail: string;
};

const main = async (): Promise<void> => {
  const envName = process.argv[2];

  process.stderr.write(`> resolving campaign client${envName ? ` for '${envName}'` : ""}\n`);
  let client;
  let orgId: string;
  try {
    const resolved = await resolveCampaignClient({ envName });
    client = resolved.client;
    orgId = resolved.orgId;
  } catch (error) {
    process.stderr.write(`> client resolve FAILED: ${String(error)}\n`);
    process.exit(1);
    return;
  }

  process.stderr.write(`> org=${orgId}\n`);
  process.stderr.write(`> base=${client.baseUrl}\n`);

  const records: StepRecord[] = [];
  const push = (step: string, ok: boolean, detail: string): void => {
    records.push({ step, ok, detail });
    process.stderr.write(`  ${ok ? "ok  " : "FAIL"} ${step} — ${detail}\n`);
  };

  const stamp = new Date().toISOString();

  // 2. create a throwaway project.
  let projectId: string | undefined;
  try {
    const project = await createProject(client, {
      name: `scai-smoke-delete ${stamp}`,
      description: "Throwaway project created by _smoke-campaign-delete.ts — safe to delete.",
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    projectId = project.id;
    push("create project", true, `id=${projectId}`);
  } catch (error) {
    push("create project", false, String(error));
  }

  // 3. create a deliverable.
  let deliverableId: string | undefined;
  if (projectId) {
    try {
      const deliverable = await createDeliverable(client, projectId, {
        name: `scai-smoke-delete deliverable ${stamp}`,
        funnel_stage: "TOP",
      });
      deliverableId = deliverable.id;
      push("create deliverable", true, `id=${deliverableId}`);
    } catch (error) {
      push("create deliverable", false, String(error));
    }
  }

  // 4. create a task.
  let taskId: string | undefined;
  if (projectId && deliverableId) {
    try {
      const task = await createTask(client, projectId, deliverableId, {
        name: `scai-smoke-delete task ${stamp}`,
      });
      taskId = task.id;
      push("create task", true, `id=${taskId}`);
    } catch (error) {
      push("create task", false, String(error));
    }
  }

  // 5. DELETE the task — contract under test.
  if (projectId && deliverableId && taskId) {
    try {
      await deleteTask(client, projectId, deliverableId, taskId);
      push("delete task", true, `id=${taskId}`);
    } catch (error) {
      push("delete task", false, String(error));
    }
  }

  // 6. DELETE the deliverable — contract under test.
  if (projectId && deliverableId) {
    try {
      await deleteDeliverable(client, projectId, deliverableId);
      push("delete deliverable", true, `id=${deliverableId}`);
    } catch (error) {
      push("delete deliverable", false, String(error));
    }
  }

  // 7. DELETE the project — contract under test.
  if (projectId) {
    try {
      await deleteProject(client, projectId);
      push("delete project", true, `id=${projectId}`);
    } catch (error) {
      push("delete project", false, String(error));
    }
  }

  const allOk = records.every((r) => r.ok);
  process.stdout.write(
    `${JSON.stringify({ envName: envName ?? "(default)", orgId, projectId, deliverableId, taskId, allOk, records }, null, 2)}\n`
  );
  process.exit(allOk ? 0 : 1);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
