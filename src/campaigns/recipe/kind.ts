/**
 * The `campaign` recipe kind — wires the Sitecore Orchestrate API into
 * the `sync` engine.
 *
 * A "campaign" in the product UI is an Orchestrate `project`; a project
 * owns deliverables, a deliverable owns tasks. `ref.id` is the
 * campaign's display NAME — recipes identify a campaign by name, not
 * UUID, exactly as `brand-kit` identifies a kit.
 *
 * `apply` is straight CRUD — `createProject` when the campaign is
 * absent, `createDeliverable` / `createTask` for missing children, and
 * `updateTask` to converge existing tasks. There is no ingestion or
 * pipeline orchestration (unlike brand). Per docs/campaigns-followups.md
 * (A3), the Orchestrate API has no verified project-metadata update, so
 * the project is create-only: deliverables and tasks are converged, and
 * anything inapplicable (a task whose parent deliverable never resolves)
 * is surfaced as `skipped`, never silently dropped.
 *
 * See docs/recipe-sync-architecture.md.
 */
import {
  createDeliverable,
  createProject,
  createTask,
  getProject,
  listProjects,
  updateTask,
  type CampaignApiClientOptions,
  type Deliverable,
  type Project,
  type Task,
} from "@/campaigns";
import { createScaiError } from "@/shared/errors";
import type {
  ApplyResult,
  KindRef,
  RecipeChange,
  RecipeKind,
  RecipePlan,
  SyncContext,
} from "@/sync";
import { resolveCampaignClient } from "./client";
import { diffCampaign } from "./diff";
import {
  CampaignRecipeSchema,
  type CampaignDeliverable,
  type CampaignRecipe,
  type CampaignTask,
} from "./schema";

/** Find a campaign (project) by display name, paging the list endpoint. */
const findProjectByName = async (
  client: CampaignApiClientOptions,
  name: string
): Promise<Project | null> => {
  let cursor: string | undefined;
  for (;;) {
    const page = await listProjects(client, { next: cursor });
    const match = page.data.find((project) => project.name === name);
    if (match) return match;
    if (!page.next || page.data.length === 0) return null;
    cursor = page.next;
  }
};

/** Project a live task into the clean recipe shape (server ids dropped). */
const toRecipeTask = (task: Task): CampaignTask => ({
  name: task.name,
  status: task.status,
  dueDate: task.due_date ?? undefined,
  priority: task.priority ?? undefined,
  description: task.description ?? undefined,
  assignee: task.assignee ?? undefined,
  labels: task.labels ?? [],
});

/** Project a live deliverable into the clean recipe shape. */
const toRecipeDeliverable = (deliverable: Deliverable): CampaignDeliverable => ({
  name: deliverable.name,
  status: deliverable.status,
  dueDate: deliverable.due_date ?? undefined,
  funnelStage: deliverable.funnel_stage,
  funnelTactics: deliverable.funnel_tactics ?? [],
  labels: deliverable.labels ?? [],
  tasks: (deliverable.tasks ?? []).map(toRecipeTask),
});

/** Capture a live campaign as a recipe. `null` when no project has the name. */
const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<CampaignRecipe | null> => {
  const client = await resolveCampaignClient(ctx);
  const found = await findProjectByName(client, ref.id);
  if (!found) return null;

  // The list endpoint omits inlined children; re-read by id to get the
  // full deliverable + task tree.
  const project = await getProject(client, found.id);

  return {
    name: project.name,
    description: project.description || undefined,
    status: project.status || undefined,
    startDate: project.start_date ?? undefined,
    dueDate: project.due_date ?? undefined,
    brandKitId: project.brandkit_id ?? undefined,
    labels: project.labels ?? [],
    deliverables: (project.deliverables ?? []).map(toRecipeDeliverable),
  };
};

/** Apply a plan — create the project, then converge deliverables and tasks. */
const apply = async (plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult> => {
  const client = await resolveCampaignClient(ctx);
  const applied: RecipeChange[] = [];
  const skipped: RecipeChange[] = [];

  const projectChange = plan.changes.find((change) => change.meta?.stage === "project");
  const deliverableChanges = plan.changes.filter((change) => change.meta?.stage === "deliverable");
  const taskChanges = plan.changes.filter((change) => change.meta?.stage === "task");

  // Resolve the campaign (project) id — creating it when the plan says so.
  let project: Project;
  if (projectChange) {
    const name = String(projectChange.after);
    ctx.logger?.info(`Creating campaign "${name}".`);
    project = await createProject(client, {
      name,
      description: projectChange.meta?.description as string | undefined,
      status: projectChange.meta?.status as string | undefined,
      start_date: projectChange.meta?.startDate as string | undefined,
      due_date: projectChange.meta?.dueDate as string | undefined,
      brandkit_id: projectChange.meta?.brandKitId as string | undefined,
      labels: (projectChange.meta?.labels as string[] | undefined) ?? [],
    });
    applied.push(projectChange);
  } else {
    const found = await findProjectByName(client, ref.id);
    if (!found) {
      throw createScaiError(`Campaign "${ref.id}" not found`, "INPUT_INVALID", {
        hint: "Push a recipe that creates the campaign, or check the name.",
      });
    }
    project = await getProject(client, found.id);
  }

  // Index existing deliverables by name so task changes can resolve
  // their parent — and so already-present deliverables are skipped.
  const deliverablesByName = new Map<string, Deliverable>(
    (project.deliverables ?? []).map((deliverable) => [deliverable.name, deliverable])
  );

  // Create missing deliverables. Their tasks are created in the task
  // pass below, which resolves against this freshly-populated index.
  for (const change of deliverableChanges) {
    if (change.kind !== "create") {
      skipped.push(change);
      continue;
    }
    const deliverable = change.meta?.deliverable as CampaignDeliverable | undefined;
    if (!deliverable) {
      skipped.push(change);
      continue;
    }
    ctx.logger?.info(`Creating deliverable "${deliverable.name}".`);
    const created = await createDeliverable(client, project.id, {
      name: deliverable.name,
      due_date: deliverable.dueDate,
      status: deliverable.status,
      funnel_stage: deliverable.funnelStage,
      funnel_tactics: deliverable.funnelTactics,
      labels: deliverable.labels,
    });
    deliverablesByName.set(created.name, created);
    applied.push(change);
  }

  // Converge tasks — create the missing ones, PUT-replace changed ones.
  for (const change of taskChanges) {
    if (change.kind === "noop") {
      skipped.push(change);
      continue;
    }
    const deliverableName = String(change.meta?.deliverableName);
    const task = change.meta?.task as CampaignTask | undefined;
    const parent = deliverablesByName.get(deliverableName);
    if (!parent || !task) {
      // The parent deliverable never resolved — surface, do not drop.
      skipped.push(change);
      continue;
    }

    if (change.kind === "create") {
      const created = await createTask(client, project.id, parent.id, {
        name: task.name,
        due_date: task.dueDate,
        status: task.status,
      });
      // createTask only accepts name/due_date/status — converge the
      // remaining fields with a follow-up update so a freshly-created
      // task does not silently lose its priority/description/assignee/labels.
      if (
        task.priority !== undefined ||
        task.description !== undefined ||
        task.assignee !== undefined ||
        (task.labels ?? []).length > 0
      ) {
        await updateTask(client, project.id, parent.id, created.id, {
          name: task.name,
          due_date: task.dueDate,
          status: task.status,
          priority: task.priority ?? null,
          description: task.description ?? null,
          assignee: task.assignee ?? null,
          labels: task.labels ?? [],
        });
      }
      applied.push(change);
    } else if (change.kind === "update") {
      // PUT is full-replacement — the recipe carries the whole task.
      await updateTask(client, project.id, parent.id, resolveTaskId(parent, task), {
        name: task.name,
        due_date: task.dueDate,
        status: task.status,
        priority: task.priority ?? null,
        description: task.description ?? null,
        assignee: task.assignee ?? null,
        labels: task.labels,
      });
      applied.push(change);
    } else {
      skipped.push(change);
    }
  }

  return { applied, skipped };
};

/** Resolve a recipe task to its server id within a live deliverable. */
const resolveTaskId = (deliverable: Deliverable, task: CampaignTask): string => {
  const match = (deliverable.tasks ?? []).find((candidate) => candidate.name === task.name);
  if (!match) {
    throw createScaiError(
      `Task "${task.name}" not found on deliverable "${deliverable.name}"`,
      "INPUT_INVALID"
    );
  }
  return match.id;
};

/** Compute the plan to converge a campaign onto `desired`. */
const plan = async (desired: CampaignRecipe, ref: KindRef, ctx: SyncContext): Promise<RecipePlan> =>
  diffCampaign(desired, await readCurrent(ref, ctx));

/** The `campaign` recipe kind. */
export const campaignKind: RecipeKind<CampaignRecipe> = {
  name: "campaign",
  schema: CampaignRecipeSchema,
  readCurrent,
  plan,
  apply,
};
