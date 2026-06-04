/**
 * Probe whether brief→campaign linking via PUT references[] works against
 * briefs in different statuses (Draft / InReview / Approved). Reverse-
 * engineers the "must be Approved" precondition.
 *
 * Plan:
 *  1. Pick a project id to link to.
 *  2. For each candidate brief id, PUT { references: [{co/Project/<projectId>}] }.
 *  3. Re-read the brief; report whether `references` now contains the link.
 *  4. Best-effort revert (PUT empty references[]) so we don't leave probe
 *     state lying around.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/probe-link-brief-to-campaign.ts <projectId> <briefId1> [briefId2 ...]
 */
import { getBrief, resolveBriefClient, updateBrief } from "@/brief";

async function probeOne(
  client: Awaited<ReturnType<typeof resolveBriefClient>>["client"],
  briefId: string,
  projectId: string
): Promise<void> {
  const before = await getBrief(client, briefId);
  console.log(`\n--- ${briefId} (status=${before.status}, refs=${before.references.length}) ---`);
  console.log(`name: ${before.name}`);
  const link = {
    type: "ExternalLink" as const,
    relatedSystem: "co",
    relatedType: "Project",
    id: projectId,
  };
  // Merge with any existing references so we don't blow away references
  // unrelated to this probe.
  const targetRefs = [
    ...before.references.filter(
      (r) => !(r.type === "ExternalLink" && r.relatedSystem === "co" && r.id === projectId)
    ),
    link,
  ];
  let putOk = false;
  let putError: unknown = null;
  try {
    await updateBrief(client, briefId, { references: targetRefs });
    putOk = true;
    console.log(`PUT references[] returned 2xx.`);
  } catch (err) {
    putError = err;
    console.error(`PUT references[] failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const after = await getBrief(client, briefId);
  const linked = after.references.some(
    (r) => r.type === "ExternalLink" && r.relatedSystem === "co" && r.id === projectId
  );
  console.log(`After PUT: refs=${after.references.length}, link present? ${linked}`);

  // Best-effort revert — drop the probe link.
  if (linked) {
    const reverted = after.references.filter(
      (r) => !(r.type === "ExternalLink" && r.relatedSystem === "co" && r.id === projectId)
    );
    try {
      await updateBrief(client, briefId, { references: reverted });
      console.log(`Reverted: dropped probe link.`);
    } catch (err) {
      console.warn(
        `Revert failed (probe link may persist): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!putOk) {
    console.log(`Outcome: PUT REJECTED. Error: ${String(putError)}`);
  } else if (!linked) {
    console.log(`Outcome: PUT accepted but link did not persist (silent drop).`);
  } else {
    console.log(`Outcome: linking WORKED at status=${before.status}.`);
  }
}

async function main(): Promise<void> {
  const [projectId, ...briefIds] = process.argv.slice(2);
  if (!projectId || briefIds.length === 0) {
    console.error("Usage: probe-link-brief-to-campaign.ts <projectId> <briefId> [briefId ...]");
    process.exit(2);
  }

  const { client } = await resolveBriefClient({});
  console.log(`Probing project id ${projectId} on ${briefIds.length} brief(s).`);

  for (const briefId of briefIds) {
    try {
      await probeOne(client, briefId, projectId);
    } catch (err) {
      console.error(
        `Probe of ${briefId} crashed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
