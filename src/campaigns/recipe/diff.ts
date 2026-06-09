/**
 * The pure diff for the `campaign` recipe kind — desired recipe vs.
 * captured current state → a `RecipePlan`. No I/O, so it is cheap to
 * unit-test and is the testable core of the kind.
 *
 * Each change carries `meta` so `apply` can act on it without parsing
 * the `path` string:
 *   - project creation  → `{ stage: "project" }`
 *   - deliverable        → `{ stage: "deliverable", deliverable, deliverableName }`
 *   - task               → `{ stage: "task", deliverableName, taskName, task }`
 *
 * A campaign's deliverables and tasks are plain CRUD children — there
 * is no ingestion or pipeline orchestration (unlike brand). Apply is
 * additive: a recipe omitting a deliverable or task never removes it.
 *
 * Per docs/campaigns-followups.md (A3), the Orchestrate API has no
 * verified project-metadata update endpoint — so the project is
 * create-only. When the campaign already exists, no `project` change
 * is emitted even if recipe metadata (description, dates, …) differs.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { isDeepStrictEqual } from "node:util";
import type { RecipeChange, RecipePlan } from "@/sync";
import type { CampaignRecipe, CampaignTask } from "./schema";

/**
 * Compare two recipe tasks ignoring undefined-vs-absent noise.
 *
 * The recipe's `handle` is also counted as identity: when the desired
 * recipe carries a handle and the current task's wire labels lack
 * `handle:<handle>`, we treat that as a difference so `apply` runs the
 * UPDATE path and stamps the label. Without this gate, a recipe that
 * adds identity to an existing task (the common case after the
 * orchestrator's lazy handle backfill) would diff as noop — and the
 * tenant would stay unidentified, so the next rename re-creates a
 * duplicate.
 */
/**
 * Find the current entity corresponding to a desired one, matching on
 * stable identity before display name. Order: `sitecoreId` (the server
 * UUID — strongest key once a push has stamped it back) → `handle` (the
 * authored kebab id, which round-trips via the wire's `handle:<x>`
 * labels) → `name` (legacy fallback for entities authored before
 * identity stamping existed).
 *
 * This is the linchpin for rename survival: when an operator renames a
 * deliverable or task in the registry, the display name no longer
 * matches, but the `sitecoreId`/`handle` still does — so the change
 * diffs as an UPDATE of the existing item instead of a CREATE of a
 * duplicate. Shared with the three-way merge in `baseline.ts` so the
 * merge and the diff agree on what "the same entity" means.
 */
export const matchByIdentity = <T extends { sitecoreId?: string; handle?: string; name: string }>(
  desired: T,
  current: readonly T[]
): T | undefined => {
  if (desired.sitecoreId) {
    const byId = current.find((c) => c.sitecoreId === desired.sitecoreId);
    if (byId) return byId;
  }
  if (desired.handle) {
    const byHandle = current.find((c) => c.handle === desired.handle);
    if (byHandle) return byHandle;
  }
  return current.find((c) => c.name === desired.name);
};

const tasksEqual = (a: CampaignTask, b: CampaignTask): boolean => {
  const baseEqual =
    a.name === b.name &&
    a.status === b.status &&
    a.dueDate === b.dueDate &&
    a.priority === b.priority &&
    a.description === b.description &&
    a.assignee === b.assignee &&
    isDeepStrictEqual(a.labels, b.labels);
  if (!baseEqual) return false;
  if (a.handle) {
    const expectedLabel = `handle:${a.handle}`;
    const hasLabel = (b.labels ?? []).includes(expectedLabel);
    if (!hasLabel) return false;
  }
  return true;
};

/** Diff a deliverable's tasks against the current deliverable's tasks. */
const diffTasks = (
  deliverableName: string,
  desiredTasks: CampaignTask[],
  currentTasks: CampaignTask[] | undefined
): RecipeChange[] => {
  const changes: RecipeChange[] = [];
  const current = currentTasks ?? [];

  for (const task of desiredTasks) {
    const path = `deliverables.${deliverableName}.tasks.${task.name}`;
    const meta = { stage: "task", deliverableName, taskName: task.name, task };
    // Match on stable identity (sitecoreId → handle) before name so a
    // renamed task converges onto its existing server item rather than
    // diffing as a brand-new task.
    const currentTask = matchByIdentity(task, current);

    if (!currentTask) {
      changes.push({
        kind: "create",
        path,
        summary: `${deliverableName} / ${task.name}`,
        after: task,
        meta,
      });
    } else if (tasksEqual(task, currentTask)) {
      changes.push({
        kind: "noop",
        path,
        summary: `${deliverableName} / ${task.name} unchanged`,
        meta,
      });
    } else {
      changes.push({
        kind: "update",
        path,
        summary: `${deliverableName} / ${task.name}`,
        before: currentTask,
        after: task,
        meta,
      });
    }
  }

  return changes;
};

/** Diff a desired campaign recipe against captured current state. */
export const diffCampaign = (
  desired: CampaignRecipe,
  current: CampaignRecipe | null
): RecipePlan => {
  const changes: RecipeChange[] = [];

  if (current === null) {
    changes.push({
      kind: "create",
      path: "project",
      summary: `Create campaign "${desired.name}"`,
      after: desired.name,
      meta: {
        stage: "project",
        description: desired.description,
        status: desired.status,
        startDate: desired.startDate,
        dueDate: desired.dueDate,
        brandKitId: desired.brandKitId,
        labels: desired.labels,
        members: desired.members,
      },
    });
  }

  const currentDeliverables = current?.deliverables ?? [];

  for (const deliverable of desired.deliverables) {
    const path = `deliverables.${deliverable.name}`;
    // Identity-first match (sitecoreId → handle → name) so a renamed
    // deliverable updates in place instead of spawning a duplicate.
    const currentDeliverable = matchByIdentity(deliverable, currentDeliverables);
    const meta = {
      stage: "deliverable",
      deliverableName: deliverable.name,
      deliverable,
    };

    if (!currentDeliverable) {
      changes.push({
        kind: "create",
        path,
        summary: `Create deliverable "${deliverable.name}"`,
        after: deliverable.name,
        meta,
      });
      // A brand-new deliverable's tasks are all created alongside it.
      changes.push(...diffTasks(deliverable.name, deliverable.tasks, []));
    } else {
      changes.push(...diffTasks(deliverable.name, deliverable.tasks, currentDeliverable.tasks));
    }
  }

  return { changes };
};
