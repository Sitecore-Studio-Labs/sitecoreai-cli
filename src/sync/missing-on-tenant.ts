/**
 * Shared "the whole entity is gone on the tenant" resolution for every
 * recipe kind's `plan()`.
 *
 * When `readCurrent` returns null the entity doesn't exist on the
 * tenant. Each kind used to hardcode `return diff(desired, null)` — an
 * unconditional recreate that ignored the baseline AND the push conflict
 * policy. That made a deliberately-deleted entity silently reappear on
 * the next background sync, and it diverged from how field-level
 * cms-edits are handled.
 *
 * A missing entity with a STORED BASELINE is just the extreme case of a
 * cms-edit: the tenant changed it from "exists" to "doesn't exist". So
 * resolve it with the SAME conflict policy as any other cms-edit — one
 * rule, shared by brand / brief / campaign:
 *
 *   - no baseline   → never pushed (or baseline reset) = genuine
 *                     first-push → recreate.
 *   - recipe-wins   → registry wins → recreate.
 *   - cms-wins      → tenant wins → honor the deletion (no-op; do NOT
 *                     resurrect it; the local recipe is kept so the
 *                     operator can still recreate or delete it explicitly).
 *   - error         → surface for the operator via the same
 *                     `POLICY_DENIED` path field conflicts use; the
 *                     panel/editor render the resolve buttons.
 */

import { createScaiError } from "@/shared/errors";
import type { PushConflictPolicy } from "./baseline";
import type { KindRef, SyncContext } from "./kind";
import type { RecipePlan } from "./plan";

export const resolveMissingCurrentPlan = async (params: {
  /** Kind name used to key the baseline (e.g. `"brand-kit"`). */
  kindName: string;
  ref: KindRef;
  ctx: SyncContext;
  /** Human label for the conflict message, e.g. `"Brand kit"`. */
  entityLabel: string;
  /** Builds the recreate plan — typically `() => diff(desired, null)`. */
  recreate: () => RecipePlan;
}): Promise<RecipePlan> => {
  const { ctx, ref } = params;

  // No baseline machinery wired (operator CLI without `--baseline` env)
  // → can't tell "deleted" from "never pushed"; treat as first-push.
  if (!ctx.baselineStorage) return params.recreate();

  let hadBaseline = false;
  try {
    const loaded = await ctx.baselineStorage.load(
      params.kindName,
      ctx.environmentName,
      ref.baselineKey ?? ref.id
    );
    hadBaseline = loaded != null;
  } catch {
    // Best-effort: a baseline-load error is treated as "no baseline"
    // (first-push) rather than blocking — matches each kind's prior
    // best-effort baseline load.
    hadBaseline = false;
  }

  // Never pushed before → genuine first-push, recreate unconditionally.
  if (!hadBaseline) return params.recreate();

  const policy: PushConflictPolicy = ctx.pushConflictPolicy ?? "error";
  if (policy === "recipe-wins") return params.recreate();
  // Honor the tenant deletion: empty plan = no-op, so syncPush writes
  // nothing and the baseline is left intact (stable across re-pushes).
  if (policy === "cms-wins") return { changes: [] };

  // error → block, same shape/code as a field-level conflict so the
  // existing resolve UI (recipe-wins re-run / cms-wins re-run) applies.
  throw createScaiError(
    `${params.entityLabel} "${ref.id}" was deleted on Sitecore (1 unresolved deletion conflict).`,
    "POLICY_DENIED",
    {
      hint: "Re-run with conflictPolicy 'recipe-wins' to recreate it, or 'cms-wins' to accept the deletion.",
      details: [`${ref.id} → deleted-on-tenant`],
    }
  );
};
