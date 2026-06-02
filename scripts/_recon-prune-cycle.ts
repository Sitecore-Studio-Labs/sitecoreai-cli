/**
 * End-to-end live verification of the PruneChildren forward path.
 *
 * Bootstraps a small scratch tree on the live tenant, runs a PruneChildren
 * IR through the real executor in apply mode with --allow-prune, asserts
 * the live tenant state matches expectations, then cleans up.
 *
 * Mirrors the path a real `recipe push` takes — same `executeIr` surface,
 * same `AuthoringApiClient` (production code, not the mock), same auth
 * flow. Just bypasses the recipe-compile layer so the scratch state is
 * tightly controlled.
 *
 * Scratch path: `/sitecore/templates/User Defined/scai-recon-<random>`.
 * `User Defined` is a standard Sitecore folder safe for ad-hoc items;
 * the random suffix lets the script run concurrently without collisions.
 * Cleanup runs in `finally` so a half-run leaves nothing behind.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_recon-prune-cycle.ts [envName]
 *
 * Default env: TestDemo.
 */
import { randomUUID } from "node:crypto";
import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";
import { executeIr } from "@/recipe/runtime/execute";
import { SITECORE_TEMPLATES } from "@/recipe/ir/sitecore-templates";
import type { OperationIr } from "@/recipe/ir/operations";

const log = (label: string, value: unknown = ""): void => {
  console.log(
    `[recon] ${label}`,
    typeof value === "string" ? value : JSON.stringify(value, null, 2)
  );
};

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment, timeoutMs } = resolveEnvironment({
    environmentName: envName,
    skipPolicy: true,
  });
  const client = createAuthoringClient({ environment, request: { timeoutMs } });

  // Scratch root + a per-run uniquifier so concurrent runs don't step
  // on each other. Templates / User Defined exists on every Sitecore
  // tenant; safe to create siblings under.
  const stamp = randomUUID().slice(0, 8);
  const scratchParentPath = "/sitecore/templates/User Defined";
  const scratchName = `scai-prune-recon-${stamp}`;
  const scratchPath = `${scratchParentPath}/${scratchName}`;

  let parentItemId: string | undefined;
  const childrenToCreate = ["Keep-A", "Keep-B", "Orphan-1", "Orphan-2"];
  const childItemIds = new Map<string, string>();

  try {
    log(`creating scratch parent at ${scratchPath}`);
    const parentResult = await client.createItem({
      parent: scratchParentPath,
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      name: scratchName,
      fields: [],
    });
    parentItemId = parentResult.itemId;
    log(`scratch parent itemId: ${parentItemId}`);

    log(`creating ${childrenToCreate.length} child items under scratch parent`);
    for (const name of childrenToCreate) {
      const child = await client.createItem({
        parent: parentItemId,
        templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
        name,
        fields: [],
      });
      childItemIds.set(name, child.itemId);
    }
    log(
      `child itemIds:`,
      Array.from(childItemIds.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
    );

    // Sanity check via getChildren — the live state should show 4 kids.
    const initialChildren = await client.getChildren({ itemId: parentItemId });
    log(`initial getChildren count: ${initialChildren.length} (expected 4)`);
    log(
      `initial children detail:`,
      initialChildren.map((c) => ({ name: c.name, itemId: c.itemId, templateId: c.templateId }))
    );
    log(`templateFilter constant: ${SITECORE_TEMPLATES.TEMPLATE_FOLDER}`);
    if (initialChildren.length !== 4) {
      throw new Error(`Setup failed: expected 4 children, got ${initialChildren.length}`);
    }

    // Build a hand-crafted PruneChildren IR. The op uses `latePath` so
    // the planner resolves the parent itemId from path at plan time —
    // same mechanism the compiler emits for tenant-pre-existing parents.
    // `allowedHandles` is the two `Keep-*` itemIds as ref-guid entries.
    const keepIds = [childItemIds.get("Keep-A")!, childItemIds.get("Keep-B")!];
    const orphanIds = [childItemIds.get("Orphan-1")!, childItemIds.get("Orphan-2")!];
    const ir: OperationIr = {
      schemaVersion: "1",
      recipeHandle: `recon-prune-${stamp}`,
      operations: [
        {
          op: "PruneChildren",
          policy: "CreateAndUpdate",
          label: `recon-prune:${scratchName}`,
          parentRefKey: "11111111-1111-1111-1111-111111111111",
          latePath: scratchPath,
          allowedHandles: keepIds.map((id) => ({ kind: "ref-guid" as const, value: id })),
          templateFilter: [SITECORE_TEMPLATES.TEMPLATE_FOLDER],
          mode: "delete",
        },
      ],
    };

    log(`running executeIr in apply mode + allowPrune=true`);
    const result = await executeIr(ir, client, {
      mode: "apply",
      allowPrune: true,
    });

    log(`aborted: ${result.aborted}`);
    log(`summary: ${JSON.stringify(result.summary)}`);

    if (result.aborted) {
      throw new Error(
        `executeIr aborted unexpectedly: ${JSON.stringify(result.plan.actions.map((a) => ({ status: a.status, reason: a.reason })))}`
      );
    }

    // The single PruneChildren action.
    const action = result.plan.actions[0];
    log(`action status: ${action.status} (expected: prune)`);
    log(`action reason: ${action.reason}`);
    if (action.status !== "prune") {
      throw new Error(`expected status 'prune', got '${action.status}'`);
    }

    // Snapshot inspection — the recursive snapshot pass should have
    // captured both orphans + their (lang, ver) field grids.
    log(`prunedItems count: ${action.prunedItems?.length ?? 0} (expected 2)`);
    if (!action.prunedItems || action.prunedItems.length !== 2) {
      throw new Error(`expected 2 prunedItems, got ${action.prunedItems?.length ?? 0}`);
    }
    for (const pruned of action.prunedItems) {
      log(
        `  pruned: ${pruned.name} (${pruned.itemId}) — ${pruned.versions.length} (lang,ver) tuples, ${pruned.children.length} descendants`
      );
      if (pruned.versions.length === 0) {
        throw new Error(`pruned item ${pruned.name} has empty versions array`);
      }
    }

    // Live verification — the orphans should be gone, keeps should remain.
    log(`reading live tenant state to verify`);
    const finalChildren = await client.getChildren({ itemId: parentItemId });
    const finalNames = finalChildren.map((c) => c.name).sort();
    log(`final getChildren: [${finalNames.join(", ")}] (expected: [Keep-A, Keep-B])`);
    if (
      finalNames.length !== 2 ||
      !finalNames.includes("Keep-A") ||
      !finalNames.includes("Keep-B")
    ) {
      throw new Error(
        `live state mismatch: expected only Keep-A + Keep-B, got [${finalNames.join(", ")}]`
      );
    }

    for (const orphanId of orphanIds) {
      const stillThere = await client.getItem({ itemId: orphanId });
      log(
        `  orphan ${orphanId} lookup: ${stillThere === null ? "GONE (good)" : "STILL PRESENT (bad)"}`
      );
      if (stillThere !== null) {
        throw new Error(`orphan ${orphanId} was not deleted`);
      }
    }

    log(`✓ prune cycle verified end-to-end against ${envName}`);
  } finally {
    if (parentItemId) {
      log(`cleanup: deleting scratch parent ${parentItemId}`);
      try {
        await client.deleteItem({ itemId: parentItemId });
        log(`cleanup done`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`cleanup FAILED — manual cleanup needed at ${scratchPath}: ${msg}`);
      }
    }
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
