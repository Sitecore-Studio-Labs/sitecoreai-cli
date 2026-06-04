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
import type { CampaignDeliverable, CampaignRecipe, CampaignTask } from "./schema";

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
  const currentByName = new Map((currentTasks ?? []).map((task) => [task.name, task]));

  for (const task of desiredTasks) {
    const path = `deliverables.${deliverableName}.tasks.${task.name}`;
    const meta = { stage: "task", deliverableName, taskName: task.name, task };
    const currentTask = currentByName.get(task.name);

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

  const currentDeliverables = new Map<string, CampaignDeliverable>(
    (current?.deliverables ?? []).map((deliverable) => [deliverable.name, deliverable])
  );

  for (const deliverable of desired.deliverables) {
    const path = `deliverables.${deliverable.name}`;
    const currentDeliverable = currentDeliverables.get(deliverable.name);
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
