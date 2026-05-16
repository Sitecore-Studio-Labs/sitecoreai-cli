/**
 * The pure diff for the `brief-type` recipe kind — desired recipe vs.
 * captured current state → a `RecipePlan`. No I/O, so it is cheap to
 * unit-test and is the testable core of the kind.
 *
 * Brief types are plain CRUD: no ingestion, no pipelines, no lifecycle
 * orchestration. The diff therefore emits at most one writing change —
 * `apply` resolves it to a single `create` or full-replacement `update`.
 *
 * Each change carries `meta` so `apply` never re-parses the `path`
 * string. Both writing changes carry the full desired recipe, because
 * the brief-type API only supports whole-record writes (POST / PUT):
 *   - type creation → `{ stage: "type", recipe }`
 *   - type update   → `{ stage: "type", recipe }`
 *
 * When the type exists, each top-level element (`label`, `description`,
 * `icon`, `iconColor`, `fields`) is also reported as a per-element
 * `update` / `noop` change so the plan reads element-by-element — those
 * carry `meta.stage = "field"` and are descriptive only; `apply` acts on
 * the single `stage: "type"` change.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { isDeepStrictEqual } from "node:util";
import type { RecipeChange, RecipePlan } from "@/sync";
import type { BriefTypeRecipe } from "./schema";

/** The top-level recipe elements compared one-by-one when the type exists. */
const COMPARED_ELEMENTS = ["label", "description", "icon", "iconColor", "fields"] as const;

/** Diff a desired brief-type recipe against captured current state. */
export const diffBriefType = (
  desired: BriefTypeRecipe,
  current: BriefTypeRecipe | null
): RecipePlan => {
  const changes: RecipeChange[] = [];

  if (current === null) {
    changes.push({
      kind: "create",
      path: "briefType",
      summary: `Create brief type "${desired.name}"`,
      after: desired.name,
      meta: { stage: "type", recipe: desired },
    });
    return { changes };
  }

  // The type exists — compare each top-level element so the plan reads
  // element-by-element.
  let anyElementChanged = false;
  for (const element of COMPARED_ELEMENTS) {
    const before = current[element];
    const after = desired[element];
    const path = `briefType.${element}`;
    const meta = { stage: "field", element };
    if (isDeepStrictEqual(before, after)) {
      changes.push({ kind: "noop", path, summary: `${element} unchanged`, meta });
    } else {
      anyElementChanged = true;
      changes.push({ kind: "update", path, summary: `${element}`, before, after, meta });
    }
  }

  // A single whole-record write converges every changed element at once
  // (the API only supports full-replacement PUT). Emitted as the lead
  // change so `apply` finds it without scanning.
  if (anyElementChanged) {
    changes.unshift({
      kind: "update",
      path: "briefType",
      summary: `Update brief type "${desired.name}"`,
      before: current.name,
      after: desired.name,
      meta: { stage: "type", recipe: desired },
    });
  }

  return { changes };
};
