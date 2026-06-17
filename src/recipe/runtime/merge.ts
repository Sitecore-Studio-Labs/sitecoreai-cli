/**
 * Shared three-way-merge classification core.
 *
 * scai's push planner ([./plan.ts]) and pull task ([../tasks/pull.ts])
 * each diff three legs — "mine" (recipe on push / disk on pull), "theirs"
 * (the tenant), and "baseline" (the last successfully synced state) — to
 * decide who moved a given field since the last sync. The two sides are
 * mirror images of the same decision:
 *
 *   push  self = recipe   other = tenant   (default conflict = cms-wins on
 *                                            the pipeline; planner default
 *                                            policy = error)
 *   pull  self = disk      other = tenant   (default conflict = tenant-wins
 *                                            on the pipeline; pull default
 *                                            policy = error)
 *
 * Both reduce to: given the hash of each leg, classify the field as
 * in-sync / self-ahead / other-ahead / conflict. The vocab differs
 * (`recipe-change`/`cms-edit` vs `disk-ahead`/`tenant-edited`) and the
 * push side additionally distinguishes a `first-push` no-baseline case,
 * but the underlying who-moved logic is identical. {@link classifyThreeWay}
 * is that single source of truth; the two task layers map it onto their
 * own vocabularies and conflict policies.
 */

/**
 * Outcome of comparing one field across the three legs. Direction-neutral
 * — callers rename `self`/`other` to recipe/disk and tenant/cms as
 * appropriate:
 *
 *   - `"in-sync"`     — self and other agree (no work to do).
 *   - `"self-ahead"`  — self diverged from baseline, other matches it
 *                       (a local change safe to propagate).
 *   - `"other-ahead"` — other diverged from baseline, self matches it
 *                       (the remote side moved; don't clobber).
 *   - `"conflict"`    — both diverged (and disagree), or no baseline is
 *                       available to attribute the divergence.
 *   - `"first-seen"`  — no baseline entry exists for this field at all.
 *                       Distinct from `conflict`: push uses it as
 *                       `first-push`; pull collapses it (see
 *                       {@link classifyThreeWayPull}).
 */
export type ThreeWayStatus = "in-sync" | "self-ahead" | "other-ahead" | "conflict" | "first-seen";

/**
 * Core three-way comparison. `undefined` means the leg has no value for
 * this field (absent on that side / not in the baseline).
 *
 *   self == other                       → in-sync
 *   no baseline entry                   → first-seen (caller decides how
 *                                          to bucket a missing baseline)
 *   self == baseline, other != baseline → other-ahead
 *   other == baseline, self != baseline → self-ahead
 *   both != baseline                    → conflict
 */
export const classifyThreeWay = (
  self: string | undefined,
  other: string | undefined,
  baseline: string | undefined
): ThreeWayStatus => {
  if (self === other) return "in-sync";
  if (baseline === undefined) return "first-seen";
  const selfMoved = self !== baseline;
  const otherMoved = other !== baseline;
  if (selfMoved && otherMoved) return "conflict";
  if (selfMoved) return "self-ahead";
  return "other-ahead";
};

// ───────────────────────────────────────────────────────────────────────────
// Push side — per-field drift classification ([./plan.ts])
// ───────────────────────────────────────────────────────────────────────────

/**
 * Push-side classification vocabulary for one drifted field (see
 * `FieldDiffEntry.classification`). `classifyAgainstBaseline` is only
 * ever called once the planner already knows the field drifts (recipe !=
 * tenant), so there is no `in-sync` outcome here.
 */
export type PushFieldClassification = "first-push" | "recipe-change" | "cms-edit" | "conflict";

/**
 * Push-side adapter over {@link classifyThreeWay}: self = recipe,
 * other = tenant.
 *
 *   - no baseline entry                  → "first-push"
 *   - tenant matches baseline (only the  → "recipe-change"
 *     recipe moved)
 *   - recipe matches baseline (only the  → "cms-edit"
 *     author moved the tenant)
 *   - both moved                         → "conflict"
 *
 * The caller (computeFieldDrift) is responsible for the no-baseline /
 * no-refKey short-circuit — it passes a defined `baselineHash` lookup
 * result here only when a baseline is loaded for the item.
 */
export const classifyPushDrift = (
  recipeHash: string,
  tenantHash: string,
  baselineHash: string | undefined
): PushFieldClassification => {
  // Push never reaches here for an in-sync field (drift is established
  // upstream), but classifyThreeWay still returns first-seen / who-moved.
  const status = classifyThreeWay(recipeHash, tenantHash, baselineHash);
  switch (status) {
    case "first-seen":
      return "first-push";
    case "self-ahead":
      // Recipe (self) moved, tenant matches baseline → safe recipe change.
      return "recipe-change";
    case "other-ahead":
      // Tenant (other) moved, recipe matches baseline → author edited CMS.
      return "cms-edit";
    default:
      // "conflict" (both moved) and the unreachable "in-sync".
      return "conflict";
  }
};

// ───────────────────────────────────────────────────────────────────────────
// Pull side — per-field classification ([../tasks/pull.ts])
// ───────────────────────────────────────────────────────────────────────────

/** Pull-side classification vocabulary for one field. */
export type PullFieldStatus = "in-sync" | "disk-ahead" | "tenant-edited" | "conflict";

/**
 * Pull-side adapter over {@link classifyThreeWay}: self = disk,
 * other = tenant. Handles the no-baseline case the same way the push
 * side does NOT — pull is first-pull-friendly:
 *
 *   - field only on disk   → "disk-ahead"    (a local addition, not a conflict)
 *   - field only on tenant → "tenant-edited" (a CMS addition, not a conflict)
 *   - both present, differ → "conflict"      (genuinely ambiguous w/o baseline)
 *
 * When a baseline IS present the who-moved attribution is exact.
 */
export const classifyPullField = (
  diskHash: string | undefined,
  tenantHash: string | undefined,
  baselineHash: string | undefined
): PullFieldStatus => {
  // `in-sync` only when both sides actually carry the value — two absent
  // legs (d === t === undefined) is not a real cell and falls through to
  // the who-moved attribution below (preserves the original
  // `d === t && d !== undefined` guard).
  if (diskHash === tenantHash && diskHash !== undefined) return "in-sync";
  // d !== t past the guard, so classifyThreeWay never returns "in-sync".
  const status = classifyThreeWay(diskHash, tenantHash, baselineHash);
  switch (status) {
    case "self-ahead":
      return "disk-ahead";
    case "other-ahead":
      return "tenant-edited";
    case "first-seen":
      // No baseline coverage. Mirror the operator's mental model:
      // present-on-one-side is an addition, both-present-but-differ is a
      // true conflict.
      if (diskHash === undefined) return "tenant-edited";
      if (tenantHash === undefined) return "disk-ahead";
      return "conflict";
    default:
      // "conflict" — both moved (and the unreachable "in-sync").
      return "conflict";
  }
};
