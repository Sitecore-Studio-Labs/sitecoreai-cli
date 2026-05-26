/**
 * The pure diff for the `brief` recipe kind — desired recipe vs.
 * captured current state → a `RecipePlan`. No I/O, so it is cheap to
 * unit-test and is the testable core of the kind.
 *
 * Unlike `brief-type` (which is a single full-replacement PUT), brief
 * instances support a partial PUT: the diff therefore emits two stages
 * of changes:
 *
 *   - One `stage: "instance"` change carries the whole desired recipe.
 *     `apply` consumes it to drive `createBrief` or `updateBrief`.
 *   - Per-element `stage: "field"` changes describe the convergence
 *     element-by-element so the rendered plan reads cleanly. They are
 *     descriptive only — the single `stage: "instance"` change is what
 *     `apply` writes.
 *
 * Identification is by `name` (the brief's display name). Brief
 * instances are not enforced unique by name on the server; the diff and
 * apply both treat "first match wins", matching the campaign-instance
 * precedent. See docs/recipe-sync-architecture.md.
 */
import { isDeepStrictEqual } from "node:util";
import type { RecipeChange, RecipePlan } from "@/sync";
import type { BriefInstanceRecipe } from "./instance-schema";

/**
 * The top-level recipe elements compared one-by-one when the brief
 * exists. `briefTypeName` is included because the diff surfaces a
 * type-change attempt — `apply` then refuses it (the Brief API has no
 * verified path to repoint an existing brief at a different type).
 */
const COMPARED_ELEMENTS = ["briefTypeName", "locale", "status", "isTemplate", "fields"] as const;

/** Diff a desired brief-instance recipe against captured current state. */
export const diffBriefInstance = (
  desired: BriefInstanceRecipe,
  current: BriefInstanceRecipe | null
): RecipePlan => {
  const changes: RecipeChange[] = [];

  if (current === null) {
    changes.push({
      kind: "create",
      path: "brief",
      summary: `Create brief "${desired.name}"`,
      after: desired.name,
      meta: { stage: "instance", recipe: desired },
    });
    return { changes };
  }

  // The brief exists — compare each element so the plan reads
  // element-by-element. `apply` acts on the lead `stage: "instance"`
  // change, not on these per-element entries.
  let anyElementChanged = false;
  for (const element of COMPARED_ELEMENTS) {
    const before = current[element];
    const after = desired[element];
    const path = `brief.${element}`;
    const meta = { stage: "field", element };
    if (isDeepStrictEqual(before, after)) {
      changes.push({ kind: "noop", path, summary: `${element} unchanged`, meta });
    } else {
      anyElementChanged = true;
      changes.push({ kind: "update", path, summary: `${element}`, before, after, meta });
    }
  }

  // A single PUT converges every changed element at once. Emitted as
  // the lead change so `apply` finds it without scanning.
  if (anyElementChanged) {
    changes.unshift({
      kind: "update",
      path: "brief",
      summary: `Update brief "${desired.name}"`,
      before: current.name,
      after: desired.name,
      meta: { stage: "instance", recipe: desired },
    });
  }

  return { changes };
};
