/**
 * Campaign baseline — per-cell SHA-256 hashes for three-way merge over
 * a project + its deliverables + their tasks.
 *
 * Cell-path scheme (flat namespace):
 *   - `project.<element>`                                 — project-level scalars
 *   - `deliverables.<name>.<element>`                     — deliverable-level scalars
 *   - `deliverables.<name>.tasks.<name>.<element>`        — task-level scalars
 *
 * Element names match the recipe field names (`description`, `status`,
 * `dueDate`, `funnelStage`, etc.). Labels and funnel tactics — arrays —
 * are hashed as a single unit per cell.
 *
 * API constraints: only tasks have a verified update endpoint
 * (`updateTask`). Project-level + deliverable-level cells classify for
 * informational purposes; under any policy the apply side has no write
 * primitive for them, so a `recipe-change` there is logged but never
 * acted on. Tasks are the meaningful three-way merge surface — and the
 * one place a silent clobber would hurt.
 */
import type { Baseline, FieldClassification } from "@/sync";
import { classifyCellHashMaps, hashJsonValue, resolveCellByPolicy } from "@/sync";
import type { CampaignDeliverable, CampaignRecipe, CampaignTask } from "./schema";

/** Per-cell hash map. Key shape is per the doc comment above. */
export interface CampaignBaselinePayload {
  schemaVersion: "1";
  cells: Record<string, string>;
}

export type CampaignBaseline = Baseline<CampaignBaselinePayload>;

const projectCellPath = (element: string): string => `project.${element}`;
const deliverableCellPath = (deliverableName: string, element: string): string =>
  `deliverables.${deliverableName}.${element}`;
const taskCellPath = (deliverableName: string, taskName: string, element: string): string =>
  `deliverables.${deliverableName}.tasks.${taskName}.${element}`;

/**
 * Walk a campaign recipe and emit per-cell hashes for the full nested
 * shape — project + every deliverable + every task. Used both at
 * baseline-capture time (post-apply, hash the merged recipe) and at
 * classification time (hash the desired and current recipes for
 * comparison).
 */
export const hashCampaignCells = (recipe: CampaignRecipe): Record<string, string> => {
  const cells: Record<string, string> = {};

  // Project-level scalars
  cells[projectCellPath("description")] = hashJsonValue(recipe.description);
  cells[projectCellPath("status")] = hashJsonValue(recipe.status);
  cells[projectCellPath("startDate")] = hashJsonValue(recipe.startDate);
  cells[projectCellPath("dueDate")] = hashJsonValue(recipe.dueDate);
  cells[projectCellPath("brandKitId")] = hashJsonValue(recipe.brandKitId);
  cells[projectCellPath("labels")] = hashJsonValue(recipe.labels ?? []);

  for (const deliverable of recipe.deliverables) {
    cells[deliverableCellPath(deliverable.name, "status")] = hashJsonValue(deliverable.status);
    cells[deliverableCellPath(deliverable.name, "dueDate")] = hashJsonValue(deliverable.dueDate);
    cells[deliverableCellPath(deliverable.name, "funnelStage")] = hashJsonValue(
      deliverable.funnelStage
    );
    cells[deliverableCellPath(deliverable.name, "funnelTactics")] = hashJsonValue(
      deliverable.funnelTactics ?? []
    );
    cells[deliverableCellPath(deliverable.name, "labels")] = hashJsonValue(
      deliverable.labels ?? []
    );

    for (const task of deliverable.tasks ?? []) {
      cells[taskCellPath(deliverable.name, task.name, "status")] = hashJsonValue(task.status);
      cells[taskCellPath(deliverable.name, task.name, "dueDate")] = hashJsonValue(task.dueDate);
      cells[taskCellPath(deliverable.name, task.name, "priority")] = hashJsonValue(task.priority);
      cells[taskCellPath(deliverable.name, task.name, "description")] = hashJsonValue(
        task.description
      );
      cells[taskCellPath(deliverable.name, task.name, "assignee")] = hashJsonValue(task.assignee);
      cells[taskCellPath(deliverable.name, task.name, "labels")] = hashJsonValue(task.labels ?? []);
    }
  }

  return cells;
};

/** Build the post-apply baseline payload for a campaign recipe. */
export const captureCampaignBaselinePayload = (
  recipe: CampaignRecipe
): CampaignBaselinePayload => ({
  schemaVersion: "1",
  cells: hashCampaignCells(recipe),
});

/**
 * Classify every cell in a campaign three-way: desired vs current vs
 * baseline. Returns a map keyed by cell path. Cells present in only
 * one side classify against the absent-value hash on the other side.
 */
export const classifyCampaignCells = (
  desired: CampaignRecipe,
  current: CampaignRecipe,
  baselinePayload: CampaignBaselinePayload | undefined
): Record<string, FieldClassification> =>
  classifyCellHashMaps(
    hashCampaignCells(desired),
    hashCampaignCells(current),
    baselinePayload?.cells
  );

/**
 * Re-export so existing campaign-domain consumers can keep importing
 * the per-cell winner selector by its local name (`cellResolution`).
 * The shared implementation lives in `@/sync`.
 */
export { resolveCellByPolicy as cellResolution };

/**
 * Build a merged campaign recipe where each cell takes either the
 * desired or current value per the policy resolution. The recipe's
 * shape is preserved (project + same deliverable set + same task set)
 * but per-element values follow the per-cell winner.
 *
 * Recipe-author intent on missing tasks: the merged recipe preserves
 * the desired recipe's deliverable + task set. Tenant-only
 * deliverables / tasks are NOT pulled into the merged recipe — the
 * recipe author hasn't asked for them. (This matches additive push
 * semantics: a recipe omitting an item does not delete it server-side,
 * but also does not adopt it back into the recipe.)
 */
export const mergeCampaignByPolicy = (
  desired: CampaignRecipe,
  current: CampaignRecipe,
  classifications: Record<string, FieldClassification>,
  policy: "error" | "recipe-wins" | "cms-wins"
): {
  merged: CampaignRecipe;
  policyErrors: Array<{ path: string; classification: FieldClassification }>;
} => {
  const policyErrors: Array<{ path: string; classification: FieldClassification }> = [];

  const currentDeliverableByName = new Map<string, CampaignDeliverable>(
    current.deliverables.map((d) => [d.name, d])
  );

  const pickProject = <K extends keyof CampaignRecipe>(element: K): CampaignRecipe[K] => {
    const path = projectCellPath(element);
    const res = resolveCellByPolicy(classifications[path] ?? "first-push", policy);
    if (res === "policyError") {
      policyErrors.push({ path, classification: classifications[path] });
      return desired[element];
    }
    return res === "current" ? current[element] : desired[element];
  };

  const mergedDeliverables: CampaignDeliverable[] = desired.deliverables.map((desiredDel) => {
    const currentDel = currentDeliverableByName.get(desiredDel.name);
    if (!currentDel) return desiredDel;
    const currentTasksByName = new Map<string, CampaignTask>(
      (currentDel.tasks ?? []).map((t) => [t.name, t])
    );

    const pickDel = <K extends keyof CampaignDeliverable>(element: K): CampaignDeliverable[K] => {
      const path = deliverableCellPath(desiredDel.name, element);
      const res = resolveCellByPolicy(classifications[path] ?? "first-push", policy);
      if (res === "policyError") {
        policyErrors.push({ path, classification: classifications[path] });
        return desiredDel[element];
      }
      return res === "current" ? currentDel[element] : desiredDel[element];
    };

    const mergedTasks: CampaignTask[] = (desiredDel.tasks ?? []).map((desiredTask) => {
      const currentTask = currentTasksByName.get(desiredTask.name);
      if (!currentTask) return desiredTask;

      const pickTask = <K extends keyof CampaignTask>(element: K): CampaignTask[K] => {
        const path = taskCellPath(desiredDel.name, desiredTask.name, element);
        const res = resolveCellByPolicy(classifications[path] ?? "first-push", policy);
        if (res === "policyError") {
          policyErrors.push({ path, classification: classifications[path] });
          return desiredTask[element];
        }
        return res === "current" ? currentTask[element] : desiredTask[element];
      };

      return {
        name: desiredTask.name,
        status: pickTask("status"),
        dueDate: pickTask("dueDate"),
        priority: pickTask("priority"),
        description: pickTask("description"),
        assignee: pickTask("assignee"),
        labels: pickTask("labels") ?? [],
      };
    });

    return {
      name: desiredDel.name,
      status: pickDel("status"),
      dueDate: pickDel("dueDate"),
      funnelStage: pickDel("funnelStage"),
      funnelTactics: pickDel("funnelTactics") ?? [],
      labels: pickDel("labels") ?? [],
      tasks: mergedTasks,
    };
  });

  const merged: CampaignRecipe = {
    name: desired.name,
    description: pickProject("description"),
    status: pickProject("status"),
    startDate: pickProject("startDate"),
    dueDate: pickProject("dueDate"),
    brandKitId: pickProject("brandKitId"),
    labels: pickProject("labels") ?? [],
    deliverables: mergedDeliverables,
  };

  return { merged, policyErrors };
};
