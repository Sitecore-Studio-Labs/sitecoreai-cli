/**
 * Probe DELETE /api/brief/v1/tasks/{id} against a live tenant.
 *
 * Plan:
 *  1. Pick a brief by id (default: first one with tasks).
 *  2. Create a disposable probe task on it so we never touch user data.
 *  3. Try DELETE on that task via the new `deleteBriefTask` helper.
 *  4. Re-list — assert the probe task is gone, original tasks survive.
 *
 * Run: pnpm exec tsx -r tsconfig-paths/register scripts/probe-delete-brief-task.ts [briefId]
 */
import {
  createBriefTask,
  deleteBriefTask,
  listBriefTasks,
  listBriefs,
  resolveBriefClient,
} from "@/brief";

async function main(): Promise<void> {
  const cliBriefId = process.argv[2];

  const { client } = await resolveBriefClient({});

  let briefId = cliBriefId;
  if (!briefId) {
    const briefs = await listBriefs(client, { limit: 10 });
    const withTasks = briefs.data.find((b) => Array.isArray(b.tasks) && b.tasks.length > 0);
    briefId = withTasks?.id ?? briefs.data[0]?.id;
    if (!briefId) throw new Error("No briefs on tenant — nothing to probe.");
    console.log(`Picked brief ${briefId} (${withTasks?.name ?? "no tasks"})`);
  } else {
    console.log(`Using supplied brief ${briefId}.`);
  }

  // Capture the existing task ids so we can verify they survive.
  const before = await listBriefTasks(client, {
    briefId,
    metadataToLoad: ["assignees"],
  });
  const beforeIds = new Set(before.data.map((t) => t.id));
  console.log(`Existing tasks: ${before.data.length}`);

  // Create a probe task.
  const probeTitle = `[probe-delete] ${new Date().toISOString()}`;
  const probe = await createBriefTask(client, {
    briefId,
    title: probeTitle,
  });
  console.log(`Created probe task ${probe.id} (${probe.title}).`);

  // DELETE.
  let deleteOk = false;
  let deleteErr: unknown = null;
  try {
    await deleteBriefTask(client, probe.id);
    deleteOk = true;
    console.log(`DELETE /api/brief/v1/tasks/${probe.id} returned 2xx.`);
  } catch (err) {
    deleteErr = err;
    console.error(`DELETE failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Re-list and report.
  const after = await listBriefTasks(client, {
    briefId,
    metadataToLoad: ["assignees"],
  });
  const afterIds = new Set(after.data.map((t) => t.id));
  const probeGone = !afterIds.has(probe.id);
  const originalsIntact = [...beforeIds].every((id) => afterIds.has(id));

  console.log(`\nAfter delete: ${after.data.length} task(s) (was ${before.data.length}).`);
  console.log(`Probe task ${probe.id} still present? ${!probeGone}`);
  console.log(`All original tasks survived? ${originalsIntact}`);

  if (deleteOk && probeGone && originalsIntact) {
    console.log("\nResult: DELETE works as expected.");
    return;
  }

  if (!deleteOk) {
    console.error(
      `\nResult: DELETE call failed. Attempting cleanup is moot — probe task may still exist.`
    );
    if (deleteErr) throw deleteErr;
    process.exit(1);
  }

  if (!probeGone) {
    console.error(
      `\nResult: DELETE returned success but task ${probe.id} is still listed. Endpoint may be a no-op.`
    );
    process.exit(1);
  }

  if (!originalsIntact) {
    const lost = [...beforeIds].filter((id) => !afterIds.has(id));
    console.error(`\nResult: DELETE removed unintended tasks: ${lost.join(", ")}. ABORT.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
