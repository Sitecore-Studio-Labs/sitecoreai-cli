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
  Baseline,
  KindRef,
  PushConflictPolicy,
  RecipeChange,
  RecipeKind,
  RecipePlan,
  SyncContext,
} from "@/sync";
import {
  captureCampaignBaselinePayload,
  classifyCampaignCells,
  mergeCampaignByPolicy,
  type CampaignBaselinePayload,
} from "./baseline";
import { resolveCampaignClient } from "./client";
import { diffCampaign } from "./diff";
import {
  CampaignRecipeSchema,
  type CampaignDeliverable,
  type CampaignRecipe,
  type CampaignTask,
} from "./schema";

const CAMPAIGN_KIND_NAME = "campaign";

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

  // Refuse before any writes when the planner marked unresolved
  // three-way conflicts under the `"error"` policy. The flag may
  // ride on the project change (preferred) or — if no project change
  // exists this run — on the first carrier change.
  const policyErrorChange = plan.changes.find((change) => change.meta?.policyError === true);
  if (policyErrorChange) {
    const errors = (policyErrorChange.meta?.policyErrors as
      | Array<{ path: string; classification: string }>
      | undefined) ?? [];
    throw createScaiError(
      `Campaign "${ref.id}" has ${errors.length} unresolved three-way merge conflict(s).`,
      "POLICY_DENIED",
      {
        hint: "Re-run with `conflictPolicy: 'cms-wins'` (preserve Sitecore AI edits) or `'recipe-wins'` (clobber). Or pull the campaign first to converge the recipe against the tenant.",
        details: errors.map((e) => `${e.path} → ${e.classification}`),
      }
    );
  }

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

  // Three-way merge baseline capture — post-apply, hash the desired
  // recipe (the recipe the planner merged-and-wrote) so the next
  // push can detect drift. Re-read the live state for an accurate
  // post-apply snapshot rather than trust desired, since incremental
  // creates may not actually land every cell (a task without a
  // resolving deliverable is `skipped`).
  if (ctx.baselineStorage) {
    const snapshot = (await readCurrent(ref, ctx)) ?? undefined;
    if (snapshot) {
      const payload = captureCampaignBaselinePayload(snapshot);
      const baseline: Baseline<CampaignBaselinePayload> = {
        envelopeVersion: "1",
        kind: CAMPAIGN_KIND_NAME,
        recipeHandle: ref.id,
        envName: ctx.environmentName,
        capturedAt: new Date().toISOString(),
        payload,
      };
      try {
        await ctx.baselineStorage.write(
          CAMPAIGN_KIND_NAME,
          ctx.environmentName,
          ref.id,
          baseline
        );
      } catch (err) {
        ctx.logger?.error?.(
          `Campaign baseline write failed for "${ref.id}" — next push will operate in two-way mode: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
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

/**
 * Compute the plan to converge a campaign onto `desired`. When
 * `ctx.baselineStorage` is plugged in, classifies every project /
 * deliverable / task cell three-way (recipe / tenant / baseline) and
 * builds a merged recipe per `ctx.pushConflictPolicy` before feeding
 * the two-way diff. Without baseline storage, falls back to the
 * existing two-way diff (every divergence reads as `first-push`).
 *
 * Annotates the resulting plan's instance-level change (the
 * `stage: "project"` create, when present) with `policyError +
 * policyErrors` if the policy is `"error"` and any cms-edit/conflict
 * cells exist. Apply consults that flag before any writes.
 */
const plan = async (
  desired: CampaignRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> => {
  const current = await readCurrent(ref, ctx);

  // Fresh create — no baseline + no tenant to merge against.
  if (current === null) return diffCampaign(desired, null);

  let baselinePayload: CampaignBaselinePayload | undefined;
  if (ctx.baselineStorage) {
    const loaded = await ctx.baselineStorage.load<CampaignBaselinePayload>(
      CAMPAIGN_KIND_NAME,
      ctx.environmentName,
      ref.id
    );
    baselinePayload = loaded?.payload;
  }

  const policy: PushConflictPolicy = ctx.pushConflictPolicy ?? "error";
  const classifications = classifyCampaignCells(desired, current, baselinePayload);
  const { merged, policyErrors } = mergeCampaignByPolicy(
    desired,
    current,
    classifications,
    policy
  );

  const basePlan = diffCampaign(merged, current);

  // Stash classification + merged-recipe + policy outcome on changes
  // so consumers (logs, UI, MCP) can drill in without re-hashing. The
  // task-level changes carry their per-cell classification; the lead
  // project change (if any) carries the policy error block.
  for (const change of basePlan.changes) {
    if (change.meta?.stage === "task") {
      const dn = String(change.meta.deliverableName);
      const tn = String(change.meta.taskName);
      const perTask: Record<string, string> = {};
      for (const [path, cls] of Object.entries(classifications)) {
        const prefix = `deliverables.${dn}.tasks.${tn}.`;
        if (path.startsWith(prefix)) perTask[path.slice(prefix.length)] = cls;
      }
      change.meta = { ...change.meta, perCellClassification: perTask, task: change.meta.task };
    } else if (change.meta?.stage === "deliverable") {
      const dn = String(change.meta.deliverableName);
      const perDel: Record<string, string> = {};
      for (const [path, cls] of Object.entries(classifications)) {
        const prefix = `deliverables.${dn}.`;
        if (path.startsWith(prefix) && !path.slice(prefix.length).includes("tasks.")) {
          perDel[path.slice(prefix.length)] = cls;
        }
      }
      change.meta = { ...change.meta, perCellClassification: perDel };
    } else if (change.meta?.stage === "project") {
      const perProject: Record<string, string> = {};
      for (const [path, cls] of Object.entries(classifications)) {
        if (path.startsWith("project.")) perProject[path.slice("project.".length)] = cls;
      }
      change.meta = {
        ...change.meta,
        perCellClassification: perProject,
        ...(policyErrors.length > 0 && { policyError: true, policyErrors }),
      };
    }
  }

  // Even if there is no `stage: "project"` change (campaign already
  // exists), policy errors must surface. Attach to the first
  // deliverable change as a fallback carrier; apply checks every
  // change for the flag.
  if (policyErrors.length > 0 && !basePlan.changes.some((c) => c.meta?.stage === "project")) {
    const carrier = basePlan.changes[0];
    if (carrier) {
      carrier.meta = { ...carrier.meta, policyError: true, policyErrors };
    }
  }

  return basePlan;
};

/** The `campaign` recipe kind. */
export const campaignKind: RecipeKind<CampaignRecipe> = {
  name: "campaign",
  schema: CampaignRecipeSchema,
  readCurrent,
  plan,
  apply,
};
