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
  addProjectMember,
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

/**
 * Identity labels callers stamp into a campaign so re-pushes can find
 * the same project even when its displayName changes between runs
 * (the LLM picks fresh phrasing on each story regenerate). Shape:
 * `["story:<storyId>", "handle:<recipeHandle>"]`. When the supplied
 * `identityLabels` include `story:`/`handle:` entries the matcher
 * prefers them over the exact-name match.
 */
const extractIdentityLabels = (
  labels: ReadonlyArray<string> | undefined
): { story: string | null; handle: string | null } => {
  let story: string | null = null;
  let handle: string | null = null;
  for (const label of labels ?? []) {
    if (label.startsWith("story:") && !story) story = label;
    if (label.startsWith("handle:") && !handle) handle = label;
  }
  return { story, handle };
};

/**
 * Find a campaign (project) by display name, paging the list endpoint.
 *
 * Matching is layered:
 *  1. When `identityLabels` carry the orchestrator's `story:` +
 *     `handle:` markers, find a project whose `labels` include BOTH —
 *     pin identity by labels so a displayName edit between pushes
 *     doesn't create a duplicate.
 *  2. Otherwise (ad-hoc recipes without identity markers), fall back
 *     to exact-name match.
 *
 * Exact-name continues to work for legacy recipes; the label-aware
 * branch only activates when the orchestrator-style markers are
 * present on the desired side.
 */
const findProjectByName = async (
  client: CampaignApiClientOptions,
  name: string,
  identityLabels: ReadonlyArray<string> = []
): Promise<Project | null> => {
  const { story, handle } = extractIdentityLabels(identityLabels);
  const useLabelMatch = story !== null && handle !== null;
  let cursor: string | undefined;
  let nameFallback: Project | null = null;
  for (;;) {
    const page = await listProjects(client, { next: cursor });
    for (const project of page.data) {
      if (project.name === name) {
        nameFallback ??= project;
      }
      if (useLabelMatch) {
        const labels = project.labels ?? [];
        if (labels.includes(story) && labels.includes(handle)) {
          return project;
        }
      }
    }
    if (!page.next || page.data.length === 0) return nameFallback;
    cursor = page.next;
  }
};

/**
 * Pull `handle:<x>` out of a labels array and return both the
 * extracted handle and the labels with that entry stripped. Used by
 * the projection helpers so the recipe surfaces `handle` + clean
 * `labels[]` rather than leaking the identity-marker as a free-form
 * label.
 */
const splitHandleFromLabels = (
  labels: ReadonlyArray<string> | undefined
): { handle: string | undefined; labels: string[] } => {
  if (!labels || labels.length === 0) return { handle: undefined, labels: [] };
  let handle: string | undefined;
  const cleaned: string[] = [];
  for (const l of labels) {
    if (l.startsWith("handle:") && !handle) {
      handle = l.slice("handle:".length);
      continue;
    }
    cleaned.push(l);
  }
  return { handle, labels: cleaned };
};

/** Project a live task into the clean recipe shape (server ids dropped). */
const toRecipeTask = (task: Task): CampaignTask => {
  const { handle, labels } = splitHandleFromLabels(task.labels);
  return {
    ...(handle ? { handle } : {}),
    name: task.name,
    status: task.status,
    dueDate: task.due_date ?? undefined,
    priority: task.priority ?? undefined,
    description: task.description ?? undefined,
    assignee: task.assignee ?? undefined,
    labels,
    // `dependencies` is a recipe-author concern — the wire stores
    // them as full UUID triples (not handle-keyed), so on pull we
    // leave the array empty. The operator re-authors deps when
    // adopting an existing project as a recipe source.
    dependencies: [],
  };
};

/** Project a live deliverable into the clean recipe shape. */
const toRecipeDeliverable = (deliverable: Deliverable): CampaignDeliverable => {
  const { handle, labels } = splitHandleFromLabels(deliverable.labels);
  return {
    ...(handle ? { handle } : {}),
    name: deliverable.name,
    status: deliverable.status,
    dueDate: deliverable.due_date ?? undefined,
    funnelStage: deliverable.funnel_stage,
    funnelTactics: deliverable.funnel_tactics ?? [],
    labels,
    tasks: (deliverable.tasks ?? []).map(toRecipeTask),
  };
};

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
    // Members aren't currently projected on pull — the read endpoint
    // returns them, but recipe-side authorship treats them as opt-in
    // (a recipe doesn't necessarily want to lock a project's
    // membership). Future: project them with a flag.
    members: [],
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
    const errors =
      (policyErrorChange.meta?.policyErrors as
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

  // Prior baseline tenantId — when present, prefer id-resolve over
  // label or name match. Survives any drift in the project's
  // displayName + identity labels.
  let priorBaselineTenantId: string | undefined;
  if (ctx.baselineStorage) {
    try {
      const prior = await ctx.baselineStorage.load<CampaignBaselinePayload>(
        CAMPAIGN_KIND_NAME,
        ctx.environmentName,
        ref.id
      );
      priorBaselineTenantId = prior?.payload?.tenantId;
    } catch {
      // Best-effort.
    }
  }

  // Resolve the campaign (project) id — creating it when the plan says so.
  let project: Project;
  if (projectChange) {
    const name = String(projectChange.after);
    const desiredLabels = (projectChange.meta?.labels as string[] | undefined) ?? [];

    // Two-stage adopt before falling through to createProject:
    //  1. Baseline-stored tenant id (strongest signal — survives any
    //     displayName + label drift).
    //  2. Identity labels on the desired side (story:<id> +
    //     handle:<x>) matching an existing project's labels.
    let adopted: Project | null = null;
    if (priorBaselineTenantId) {
      try {
        adopted = await getProject(client, priorBaselineTenantId);
      } catch {
        adopted = null;
      }
    }
    if (!adopted) {
      const labelMatch = await findProjectByName(client, name, desiredLabels);
      if (labelMatch && labelMatch.name !== name) {
        adopted = await getProject(client, labelMatch.id);
      }
    }
    if (adopted) {
      ctx.logger?.info(
        `Adopting existing campaign "${adopted.name}" (id ${adopted.id}) — recipe name "${name}" was a rename or recipe-handle drift.`
      );
      project = adopted;
      applied.push(projectChange);
    } else {
      ctx.logger?.info(`Creating campaign "${name}".`);
      project = await createProject(client, {
        name,
        description: projectChange.meta?.description as string | undefined,
        status: projectChange.meta?.status as string | undefined,
        start_date: projectChange.meta?.startDate as string | undefined,
        due_date: projectChange.meta?.dueDate as string | undefined,
        brandkit_id: projectChange.meta?.brandKitId as string | undefined,
        labels: desiredLabels,
      });
      applied.push(projectChange);
    }

    // POST each member to the project. The Orchestrate UI shows the
    // project only to its members, so a project with no real-user
    // members is invisible in the UI even though it exists on the
    // wire. Promote the first member to ADMIN if none is — guards
    // against a service-account-only project the operator can't see.
    const members =
      (projectChange.meta?.members as
        | Array<{ authorId: string; role?: "ADMIN" | "EDITOR" | "VIEWER" | "MEMBER" }>
        | undefined) ?? [];
    if (members.length > 0) {
      const ensured = members.some((m) => m.role === "ADMIN")
        ? members
        : members.map((m, i) => (i === 0 ? { authorId: m.authorId, role: "ADMIN" as const } : m));
      ctx.logger?.info(`Adding ${ensured.length} member(s) to "${name}".`);
      for (const m of ensured) {
        try {
          await addProjectMember(client, project.id, {
            id: m.authorId,
            ...(m.role ? { role: m.role } : {}),
          });
        } catch (err) {
          ctx.logger?.warn?.(
            `Failed to add member ${m.authorId} (${m.role ?? "default role"}) to "${name}": ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }
  } else {
    // Update branch: same id-first preference as the create branch.
    let resolved: Project | null = null;
    if (priorBaselineTenantId) {
      try {
        resolved = await getProject(client, priorBaselineTenantId);
      } catch {
        resolved = null;
      }
    }
    if (!resolved) {
      const found = await findProjectByName(client, ref.id);
      if (found) resolved = await getProject(client, found.id);
    }
    if (!resolved) {
      throw createScaiError(`Campaign "${ref.id}" not found`, "INPUT_INVALID", {
        hint: "Push a recipe that creates the campaign, or check the name.",
      });
    }
    project = resolved;
  }

  // Index existing deliverables by their stamped `handle:<handle>`
  // label first, then by name as fallback. Re-syncs match by label
  // even when the LLM picks a different display name between runs.
  // Helper extracts the value out of a `handle:<x>` label, if present.
  const handleFromLabels = (labels: ReadonlyArray<string> | undefined): string | null => {
    if (!labels) return null;
    for (const l of labels) {
      if (l.startsWith("handle:")) return l.slice("handle:".length);
    }
    return null;
  };
  const deliverablesByName = new Map<string, Deliverable>(
    (project.deliverables ?? []).map((deliverable) => [deliverable.name, deliverable])
  );
  const deliverablesByHandle = new Map<string, Deliverable>();
  for (const deliverable of project.deliverables ?? []) {
    const h = handleFromLabels(deliverable.labels);
    if (h) deliverablesByHandle.set(h, deliverable);
  }

  /** Find an existing deliverable by recipe shape, preferring label. */
  const findExistingDeliverable = (
    recipeDeliverable: CampaignDeliverable
  ): Deliverable | undefined => {
    if (recipeDeliverable.handle) {
      const byHandle = deliverablesByHandle.get(recipeDeliverable.handle);
      if (byHandle) return byHandle;
    }
    return deliverablesByName.get(recipeDeliverable.name);
  };

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

    // Even when the planner classified this as a fresh create, check
    // for an existing deliverable carrying our recipe's `handle:<x>`
    // label — adopt it rather than spawning a duplicate.
    const existing = findExistingDeliverable(deliverable);
    if (existing) {
      ctx.logger?.info(
        `Adopting existing deliverable "${existing.name}" via handle "${deliverable.handle ?? "(name)"}" — recipe name "${deliverable.name}" matched.`
      );
      applied.push(change);
      continue;
    }

    // Stamp `handle:<handle>` into labels at create time so future
    // re-syncs (or other operators authoring against the same recipe)
    // can match by label. Idempotent — never appends the same label
    // twice because the recipe's authored labels[] is the source of
    // truth on each push.
    const labelsWithHandle = deliverable.handle
      ? [
          ...(deliverable.labels ?? []).filter((l) => !l.startsWith("handle:")),
          `handle:${deliverable.handle}`,
        ]
      : (deliverable.labels ?? []);

    ctx.logger?.info(`Creating deliverable "${deliverable.name}".`);
    const created = await createDeliverable(client, project.id, {
      name: deliverable.name,
      due_date: deliverable.dueDate,
      status: deliverable.status,
      funnel_stage: deliverable.funnelStage,
      funnel_tactics: deliverable.funnelTactics,
      labels: labelsWithHandle,
    });
    deliverablesByName.set(created.name, created);
    if (deliverable.handle) {
      deliverablesByHandle.set(deliverable.handle, created);
    }
    applied.push(change);
  }

  // Track every task we've touched so the dependency second-pass can
  // resolve handle references to {project, deliverable, task} triples.
  // Includes tasks we created this run AND tasks already on the
  // tenant that the recipe hasn't changed — a recipe may declare a
  // dependency on a previously-pushed task.
  type ResolvedTaskRef = {
    projectId: string;
    deliverableId: string;
    taskId: string;
  };
  const tasksByHandle = new Map<string, ResolvedTaskRef>();
  for (const deliverable of project.deliverables ?? []) {
    for (const t of deliverable.tasks ?? []) {
      // Prefer the `handle:<x>` label stamped at create time — that's
      // the identity the orchestrator stamps on every task it pushes
      // for stable dependency + re-sync resolution.
      const labelHandle = handleFromLabels(t.labels);
      if (labelHandle) {
        tasksByHandle.set(labelHandle, {
          projectId: project.id,
          deliverableId: deliverable.id,
          taskId: t.id,
        });
        continue;
      }
      // Legacy fallback for tasks pushed before the label scheme
      // landed: match by recipe name and capture the recipe's handle.
      const recipeTask = taskChanges
        .map((c) => c.meta?.task as CampaignTask | undefined)
        .find((rt) => rt?.name === t.name);
      if (recipeTask?.handle) {
        tasksByHandle.set(recipeTask.handle, {
          projectId: project.id,
          deliverableId: deliverable.id,
          taskId: t.id,
        });
      }
    }
  }

  // Converge tasks — create the missing ones, PUT-replace changed ones.
  // Defer setting `dependencies` to a second pass — the deps reference
  // sibling tasks by handle, and not all may exist yet when this loop
  // visits a referencing task.
  const tasksWithDeps: Array<{
    task: CampaignTask;
    parent: Deliverable;
    taskId: string;
  }> = [];
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

    let taskId: string | null = null;
    if (change.kind === "create") {
      // Adopt instead of duplicate when an existing task on this
      // deliverable carries our recipe's `handle:<x>` label.
      const existingByHandle = task.handle
        ? (parent.tasks ?? []).find((t) => (t.labels ?? []).includes(`handle:${task.handle}`))
        : undefined;
      const labelsWithHandle = task.handle
        ? [...(task.labels ?? []).filter((l) => !l.startsWith("handle:")), `handle:${task.handle}`]
        : (task.labels ?? []);
      if (existingByHandle) {
        ctx.logger?.info(
          `Adopting existing task "${existingByHandle.name}" via handle "${task.handle}" — recipe name "${task.name}" matched.`
        );
        taskId = existingByHandle.id;
        await updateTask(client, project.id, parent.id, taskId, {
          name: task.name,
          due_date: task.dueDate,
          status: task.status,
          priority: task.priority ?? null,
          description: task.description ?? null,
          assignee: task.assignee ?? null,
          labels: labelsWithHandle,
        });
        applied.push(change);
      } else {
        const created = await createTask(client, project.id, parent.id, {
          name: task.name,
          due_date: task.dueDate,
          status: task.status,
        });
        taskId = created.id;
        // createTask only accepts name/due_date/status — converge the
        // remaining fields with a follow-up update so a freshly-created
        // task does not silently lose its priority/description/
        // assignee/labels. Stamp `handle:<x>` into labels here so the
        // task is matchable on re-sync regardless of name drift.
        if (
          task.priority !== undefined ||
          task.description !== undefined ||
          task.assignee !== undefined ||
          labelsWithHandle.length > 0
        ) {
          await updateTask(client, project.id, parent.id, created.id, {
            name: task.name,
            due_date: task.dueDate,
            status: task.status,
            priority: task.priority ?? null,
            description: task.description ?? null,
            assignee: task.assignee ?? null,
            labels: labelsWithHandle,
          });
        }
        applied.push(change);
      }
    } else if (change.kind === "update") {
      // PUT is full-replacement — the recipe carries the whole task.
      taskId = resolveTaskId(parent, task);
      await updateTask(client, project.id, parent.id, taskId, {
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

    if (taskId !== null) {
      if (task.handle) {
        tasksByHandle.set(task.handle, {
          projectId: project.id,
          deliverableId: parent.id,
          taskId,
        });
      }
      if ((task.dependencies ?? []).length > 0) {
        tasksWithDeps.push({ task, parent, taskId });
      }
    }
  }

  // Dependencies second pass — now that every task in the project
  // has a UUID, resolve each task's `dependencies: [<handle>]` list
  // to the full `{project_id, project_deliverable_id, task_id}`
  // triples the Brief API expects and PUT them back.
  for (const { task, parent, taskId } of tasksWithDeps) {
    const resolved: Array<{
      project_id: string;
      project_deliverable_id: string;
      task_id: string;
    }> = [];
    const missing: string[] = [];
    for (const depHandle of task.dependencies ?? []) {
      const ref = tasksByHandle.get(depHandle);
      if (!ref) {
        missing.push(depHandle);
        continue;
      }
      resolved.push({
        project_id: ref.projectId,
        project_deliverable_id: ref.deliverableId,
        task_id: ref.taskId,
      });
    }
    if (missing.length > 0) {
      ctx.logger?.warn?.(
        `Task "${task.name}" references unknown task handles in dependencies: ${missing.join(", ")}. Skipped those refs.`
      );
    }
    if (resolved.length === 0) continue;
    try {
      await updateTask(client, project.id, parent.id, taskId, {
        name: task.name,
        due_date: task.dueDate,
        status: task.status,
        priority: task.priority ?? null,
        description: task.description ?? null,
        assignee: task.assignee ?? null,
        labels: task.labels,
        dependencies: resolved,
      });
    } catch (err) {
      ctx.logger?.warn?.(
        `Failed to set dependencies on task "${task.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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
      const payload = captureCampaignBaselinePayload(snapshot, project.id);
      const baseline: Baseline<CampaignBaselinePayload> = {
        envelopeVersion: "1",
        kind: CAMPAIGN_KIND_NAME,
        recipeHandle: ref.id,
        envName: ctx.environmentName,
        capturedAt: new Date().toISOString(),
        payload,
      };
      try {
        await ctx.baselineStorage.write(CAMPAIGN_KIND_NAME, ctx.environmentName, ref.id, baseline);
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

/**
 * Resolve a recipe task to its server id within a live deliverable.
 * Matches by `handle:<handle>` label first when the recipe carries a
 * handle, then falls back to name — the same labels-first strategy
 * the deliverable matcher uses.
 */
const resolveTaskId = (deliverable: Deliverable, task: CampaignTask): string => {
  if (task.handle) {
    const handleLabel = `handle:${task.handle}`;
    const byLabel = (deliverable.tasks ?? []).find((candidate) =>
      (candidate.labels ?? []).includes(handleLabel)
    );
    if (byLabel) return byLabel.id;
  }
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
  const { merged, policyErrors } = mergeCampaignByPolicy(desired, current, classifications, policy);

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
