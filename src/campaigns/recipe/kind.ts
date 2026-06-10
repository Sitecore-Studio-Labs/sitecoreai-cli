/**
 * The `campaign` recipe kind — wires the Sitecore Orchestrate API into
 * the `sync` engine.
 *
 * A "campaign" in the product UI is an Orchestrate `project`; a project
 * owns deliverables, a deliverable owns tasks. `ref.id` is the
 * campaign's display NAME — recipes identify a campaign by name, not
 * UUID, exactly as `brand-kit` identifies a kit.
 *
 * `apply` is straight CRUD with a full-object update at every level:
 * `createProject` when the campaign is absent; `createDeliverable` /
 * `createTask` for missing children; and `updateProject` /
 * `updateDeliverable` / `updateTask` to converge existing entities (each
 * a full-object PUT — verified supported 2026-06-10, see diff.ts). There
 * is no ingestion or pipeline orchestration (unlike brand). Anything
 * inapplicable (a task whose parent deliverable never resolves) is
 * surfaced as `skipped`, never silently dropped.
 *
 * Two non-obvious invariants the apply MUST preserve (both were silent
 * "edits don't stick" bugs): (1) adopt an existing campaign on ANY identity
 * match, not only a rename — else a re-push without a stamped sitecoreId
 * spawns a DUPLICATE empty project; (2) never overwrite the in-memory
 * project/deliverable tree with a PUT's LEAN response — it omits the inline
 * children the child-update matching depends on.
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
  updateDeliverable,
  updateProject,
  updateTask,
  type CampaignApiClientOptions,
  type Deliverable,
  type Project,
  type Task,
} from "@/campaigns";
import { createScaiError, toMergeConflicts } from "@/shared/errors";
import { resolveMissingCurrentPlan } from "@/sync";
import type {
  ApplyResult,
  Baseline,
  KindRef,
  PushConflictPolicy,
  RecipeChange,
  RecipeKind,
  RecipePlan,
  ResolvedIdentity,
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
  // Match by the stable `handle:` label ALONE (it's unique per campaign)
  // — or by both `story:` + `handle:` when story is also supplied. This
  // is what lets PULL find a project whose displayName drifted (a rename)
  // by its handle, mirroring how briefs match by their name-marker —
  // instead of only by exact name or a stamped `sitecoreId`. Exact-name
  // remains the fallback for ad-hoc recipes without identity markers.
  const useLabelMatch = handle !== null;
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
        const handleHit = labels.includes(handle);
        const storyHit = story === null || labels.includes(story);
        if (handleHit && storyHit) {
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

/**
 * Build a `taskId → handle` index for the whole project, used to
 * reverse-map dependency UUID triples back to handle references.
 * Only tasks that carry a `handle:<x>` label appear in the map —
 * legacy tasks without a handle can't be referenced by handle on the
 * recipe side, so omitting them is correct.
 */
const indexHandlesByTaskId = (project: Project): Map<string, string> => {
  const index = new Map<string, string>();
  for (const deliverable of project.deliverables ?? []) {
    for (const task of deliverable.tasks ?? []) {
      const { handle } = splitHandleFromLabels(task.labels);
      if (handle) index.set(task.id, handle);
    }
  }
  return index;
};

/**
 * Project the wire's `dependencies: [{project_id, project_deliverable_id,
 * task_id}, ...]` triples into the recipe's `dependencies: [<handle>]`
 * shape. Drops any entry whose `task_id` resolves to a task without a
 * handle (legacy, pre-handle-stamping tasks can't be referenced by
 * handle so silently dropping is the only sensible outcome — adding
 * the UUID directly would make the recipe non-portable and break the
 * apply path's handle-based resolver).
 */
const reverseMapDependencyHandles = (
  wireDeps: unknown,
  handleByTaskId: Map<string, string>
): string[] => {
  if (!Array.isArray(wireDeps)) return [];
  const handles: string[] = [];
  for (const dep of wireDeps) {
    if (!dep || typeof dep !== "object") continue;
    const taskId = (dep as { task_id?: unknown }).task_id;
    if (typeof taskId !== "string") continue;
    const handle = handleByTaskId.get(taskId);
    if (handle) handles.push(handle);
  }
  return handles;
};

/** Project a live task into the clean recipe shape (server ids dropped). */
const toRecipeTask = (task: Task, handleByTaskId: Map<string, string>): CampaignTask => {
  const { handle, labels } = splitHandleFromLabels(task.labels);
  return {
    ...(handle ? { handle } : {}),
    // Surface the server UUID so it round-trips back onto the recipe.
    // The diff/merge match on it before name, so a later rename
    // converges onto this task instead of creating a duplicate.
    ...(task.id ? { sitecoreId: task.id } : {}),
    name: task.name,
    status: task.status,
    dueDate: task.due_date ?? undefined,
    priority: task.priority ?? undefined,
    description: task.description ?? undefined,
    assignee: task.assignee ?? undefined,
    labels,
    // Reverse-mapped from the wire's UUID triples. Entries whose
    // `task_id` references a task without a `handle:<x>` label are
    // dropped — that task can't be addressed by handle on the recipe
    // side, and the apply path would just log it as missing on the
    // next push.
    dependencies: reverseMapDependencyHandles(task.dependencies, handleByTaskId),
  };
};

/** Project a live deliverable into the clean recipe shape. */
const toRecipeDeliverable = (
  deliverable: Deliverable,
  handleByTaskId: Map<string, string>
): CampaignDeliverable => {
  const { handle, labels } = splitHandleFromLabels(deliverable.labels);
  return {
    ...(handle ? { handle } : {}),
    // Round-trip the server UUID — see toRecipeTask.
    ...(deliverable.id ? { sitecoreId: deliverable.id } : {}),
    name: deliverable.name,
    status: deliverable.status,
    dueDate: deliverable.due_date ?? undefined,
    funnelStage: deliverable.funnel_stage,
    funnelTactics: deliverable.funnel_tactics ?? [],
    labels,
    tasks: (deliverable.tasks ?? []).map((task) => toRecipeTask(task, handleByTaskId)),
  };
};

/**
 * Capture a live campaign as a recipe. Returns `null` when the campaign
 * can't be resolved on the tenant.
 *
 * Resolution order:
 *  1. `ref.tenantId` (Sitecore Orchestrate project UUID) — when set,
 *     read the project directly by id and skip the list/search. The
 *     orchestrator passes this via `--sitecore-id` once the first push
 *     has stamped a UUID onto the registry's recipe, so name/whitespace
 *     drift on either side no longer breaks pull.
 *  2. `ref.id` (display name) — paged list search. Legacy path, used
 *     when no Sitecore UUID is available yet.
 */
const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<CampaignRecipe | null> => {
  const client = await resolveCampaignClient(ctx);

  let project: Project | null = null;
  if (ref.tenantId) {
    try {
      project = await getProject(client, ref.tenantId);
    } catch {
      // Best-effort — fall through to the name-based search below so a
      // stale/wrong tenantId on the ref doesn't permanently block pull.
      project = null;
    }
  }
  if (!project) {
    // Pull-by-identity: when the caller knows the campaign's stable
    // handle (ref.baselineKey, set from `--handle`), match the project by
    // its `handle:` label so a renamed campaign still resolves — not just
    // by exact display name. Falls back to name match inside
    // findProjectByName when no handle is supplied.
    const identityLabels = ref.baselineKey ? [`handle:${ref.baselineKey}`] : [];
    const found = await findProjectByName(client, ref.id, identityLabels);
    if (!found) return null;
    // The list endpoint omits inlined children; re-read by id to get
    // the full deliverable + task tree.
    project = await getProject(client, found.id);
  }

  const handleByTaskId = indexHandlesByTaskId(project);

  return {
    // Round-trip the project UUID so the next push can resolve by id.
    ...(project.id ? { sitecoreId: project.id } : {}),
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
    deliverables: (project.deliverables ?? []).map((d) => toRecipeDeliverable(d, handleByTaskId)),
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
        conflicts: toMergeConflicts(errors),
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
        ref.baselineKey ?? ref.id
      );
      priorBaselineTenantId = prior?.payload?.tenantId;
    } catch {
      // Best-effort.
    }
  }
  // Ref-supplied tenantId (registry-tracked) wins over the baseline-
  // stored one. Falls back when absent.
  const effectiveTenantId = ref.tenantId ?? priorBaselineTenantId;

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
    if (effectiveTenantId) {
      try {
        adopted = await getProject(client, effectiveTenantId);
      } catch {
        adopted = null;
      }
    }
    if (!adopted) {
      const labelMatch = await findProjectByName(client, name, desiredLabels);
      // Adopt whenever an existing project matches (by identity label OR
      // exact name) — NOT only on a rename. The old `name !== name` guard
      // meant a re-push of an UNCHANGED campaign that lacks a stamped
      // sitecoreId fell through to createProject and spawned a DUPLICATE
      // empty project — the root cause of "campaign edits don't stick":
      // every update landed on a fresh duplicate while the real campaign
      // (with the deliverables) was orphaned.
      if (labelMatch) {
        adopted = await getProject(client, labelMatch.id);
      }
    }
    if (adopted) {
      ctx.logger?.info(
        `Adopting existing campaign "${adopted.name}" (id ${adopted.id}) — recipe name "${name}" was a rename or recipe-handle drift.`
      );
      project = adopted;
      // The campaign already exists. Converge it onto the recipe with ONE
      // full-object `PUT /projects/{id}` (verified supported 2026-06-10),
      // covering two things:
      //   - identity labels (`story:`/`handle:`) an early push may never
      //     have stamped — without them pull can't resolve it by handle;
      //   - project-level field drift (name/description/status/dates) when
      //     the diff emitted an `update` change.
      // Spread the wire object first so server-managed fields (id, org_id,
      // members, timestamps) survive; override only what the recipe owns.
      const identityLabels = desiredLabels.filter(
        (l) => l.startsWith("story:") || l.startsWith("handle:")
      );
      const existingLabels = adopted.labels ?? [];
      const missingLabels = identityLabels.filter((l) => !existingLabels.includes(l));
      const fieldUpdate = projectChange.meta?.update === true;
      if (missingLabels.length > 0 || fieldUpdate) {
        const m = projectChange.meta ?? {};
        // Full-object PUT — spread the WHOLE wire project (incl. the inline
        // `deliverables` view) so the API preserves the child associations;
        // omitting them makes a full-replace clear them. Override only the
        // recipe-owned scalar fields. Dates are special: the recipe authors
        // a bare `YYYY-MM-DD` while the wire stores a datetime, so override
        // a date ONLY when its day actually changed — pushing a bare date
        // that merely reformats the same day corrupts the PUT and drops the
        // deliverables.
        const dayChanged = (recipeVal: unknown, wireVal: unknown): boolean =>
          String(recipeVal ?? "").slice(0, 10) !== String(wireVal ?? "").slice(0, 10);
        const body: Record<string, unknown> = {
          ...(adopted as unknown as Record<string, unknown>),
          labels: Array.from(new Set([...existingLabels, ...desiredLabels])),
        };
        if (fieldUpdate) {
          if (m.name !== undefined) body.name = m.name;
          if (m.description !== undefined) body.description = m.description;
          if (m.status !== undefined) body.status = m.status;
          if (m.startDate !== undefined && dayChanged(m.startDate, adopted.start_date))
            body.start_date = m.startDate;
          if (m.dueDate !== undefined && dayChanged(m.dueDate, adopted.due_date))
            body.due_date = m.dueDate;
          if (m.brandKitId !== undefined) body.brandkit_id = m.brandKitId;
        }
        try {
          // Do NOT reassign `project` from the PUT response — it returns a
          // LEAN project with no inline `deliverables`, which would wipe the
          // in-memory tree the deliverable/task matching below depends on
          // (findExistingDeliverable would then miss and skip every child
          // update). Keep the full `adopted` tree; the PUT's side effect on
          // the tenant is all we need.
          await updateProject(client, adopted.id, body);
          ctx.logger?.info(
            `Updated campaign "${adopted.name}"${fieldUpdate ? " fields" : ""}${
              missingLabels.length > 0 ? ` (+${missingLabels.length} identity label(s))` : ""
            }.`
          );
        } catch (error) {
          ctx.logger?.warn?.(
            `Could not update project "${adopted.name}" via PUT /projects: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
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
    if (effectiveTenantId) {
      try {
        resolved = await getProject(client, effectiveTenantId);
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
    if (recipeDeliverable.sitecoreId) {
      const byId = (project.deliverables ?? []).find((d) => d.id === recipeDeliverable.sitecoreId);
      if (byId) return byId;
    }
    if (recipeDeliverable.handle) {
      const byHandle = deliverablesByHandle.get(recipeDeliverable.handle);
      if (byHandle) return byHandle;
    }
    return deliverablesByName.get(recipeDeliverable.name);
  };

  // Create missing deliverables. Their tasks are created in the task
  // pass below, which resolves against this freshly-populated index.
  for (const change of deliverableChanges) {
    const deliverable = change.meta?.deliverable as CampaignDeliverable | undefined;
    if (!deliverable) {
      skipped.push(change);
      continue;
    }

    // Update branch: an existing deliverable whose own fields drifted.
    // Full-object PUT — spread the wire deliverable so server-managed
    // fields survive, override the recipe-owned ones.
    if (change.kind === "update") {
      const existing = findExistingDeliverable(deliverable);
      if (!existing) {
        skipped.push(change);
        continue;
      }
      const labelsWithHandle = deliverable.handle
        ? [
            ...(deliverable.labels ?? []).filter((l) => !l.startsWith("handle:")),
            `handle:${deliverable.handle}`,
          ]
        : (deliverable.labels ?? []);
      // Full-object PUT — spread the whole wire deliverable (incl. its
      // inline `tasks` view) so the API preserves the task associations;
      // omitting them clears them. Override only the deliverable's own
      // scalars; guard the date so a bare reformat of the same day doesn't
      // corrupt the PUT and drop the tasks (same trap as the project PUT).
      const delDayChanged = (r: unknown, w: unknown): boolean =>
        String(r ?? "").slice(0, 10) !== String(w ?? "").slice(0, 10);
      const { tasks: _omitDelTasks, ...deliverableWire } = existing as unknown as Record<
        string,
        unknown
      >;
      const delBody: Record<string, unknown> = {
        ...deliverableWire,
        name: deliverable.name,
        status: deliverable.status,
        funnel_stage: deliverable.funnelStage,
        funnel_tactics: deliverable.funnelTactics ?? [],
        labels: labelsWithHandle,
      };
      if (delDayChanged(deliverable.dueDate, (existing as { due_date?: string }).due_date))
        delBody.due_date = deliverable.dueDate;
      try {
        await updateDeliverable(client, project.id, existing.id, delBody);
        // Re-index under the (possibly renamed) recipe name + handle, but
        // keep `existing` (which carries the inline `tasks`) as the value —
        // NOT the lean PUT response — so the task loop below can still
        // resolve task ids against this deliverable.
        deliverablesByName.set(deliverable.name, existing);
        if (deliverable.handle) deliverablesByHandle.set(deliverable.handle, existing);
        ctx.logger?.info(`Updated deliverable "${deliverable.name}".`);
        applied.push(change);
      } catch (error) {
        ctx.logger?.warn?.(
          `Failed to update deliverable "${deliverable.name}": ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        skipped.push(change);
      }
      continue;
    }

    if (change.kind !== "create") {
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
      // deliverable matches our recipe's identity — by server UUID
      // first, then the `handle:<x>` label. This is the safety net for
      // a rename the planner classified as a create (no name match):
      // the existing item is updated in place rather than duplicated.
      const existingById = task.sitecoreId
        ? (parent.tasks ?? []).find((t) => t.id === task.sitecoreId)
        : undefined;
      const existingByHandle =
        existingById ??
        (task.handle
          ? (parent.tasks ?? []).find((t) => (t.labels ?? []).includes(`handle:${task.handle}`))
          : undefined);
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
      // Stamp `handle:<x>` on update writes too, not just on create.
      // Without this, a task whose recipe gained identity (via the
      // orchestrator's lazy backfill or a hand-edit) would never
      // reach the tenant — the apply path would push the raw
      // operator-authored labels and leave the wire unidentified.
      const labelsWithHandle = task.handle
        ? [...(task.labels ?? []).filter((l) => !l.startsWith("handle:")), `handle:${task.handle}`]
        : (task.labels ?? []);
      // Full-replace PUT — spread the current wire task so server-managed
      // fields (id, org_id, start_date, …) are present, then override the
      // recipe-owned fields. A partial body is silently ignored.
      const wireTask = (parent.tasks ?? []).find((t) => t.id === taskId) as
        | Record<string, unknown>
        | undefined;
      await updateTask(client, project.id, parent.id, taskId, {
        ...(wireTask ?? {}),
        name: task.name,
        due_date: task.dueDate ?? (wireTask?.due_date as string | undefined),
        status: task.status,
        priority: task.priority ?? null,
        description: task.description ?? null,
        assignee: task.assignee ?? null,
        labels: labelsWithHandle,
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
      const baselineKey = ref.baselineKey ?? ref.id;
      const baseline: Baseline<CampaignBaselinePayload> = {
        envelopeVersion: "1",
        kind: CAMPAIGN_KIND_NAME,
        recipeHandle: baselineKey,
        envName: ctx.environmentName,
        capturedAt: new Date().toISOString(),
        payload,
      };
      try {
        await ctx.baselineStorage.write(
          CAMPAIGN_KIND_NAME,
          ctx.environmentName,
          baselineKey,
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

  // Surface resolved Sitecore UUIDs so the caller (orchestrator →
  // registry) can persist them onto the recipe and skip scai's
  // baseline / label fallback on subsequent pushes.
  //
  // Re-read the converged project so we emit an identity for EVERY
  // deliverable + task — including handle-less ones and unchanged
  // (noop) ones, which the old handle-keyed emission silently dropped.
  // That gap is why renames duplicated: a task whose id never reached
  // the recipe could only be re-matched by its (volatile) name. Each
  // nested identity carries `parentName` so the caller can place it even
  // when the parent deliverable has no handle. Best-effort: fall back to
  // the pre-apply snapshot if the re-read fails (identities are an
  // optimization, not a correctness gate).
  const converged = await getProject(client, project.id).catch(() => project);
  const identities: ResolvedIdentity[] = [];
  // Campaign-level identity. `ref.baselineKey` carries the recipe's
  // stable handle; `ref.id` is the display name at push time.
  identities.push({
    scope: "campaign",
    sitecoreId: converged.id,
    ...(ref.baselineKey ? { handle: ref.baselineKey } : {}),
    name: converged.name,
  });
  for (const deliverable of converged.deliverables ?? []) {
    const delHandle = handleFromLabels(deliverable.labels) ?? undefined;
    identities.push({
      scope: "deliverable",
      sitecoreId: deliverable.id,
      ...(delHandle ? { handle: delHandle } : {}),
      name: deliverable.name,
      ...(ref.baselineKey ? { parentHandle: ref.baselineKey } : {}),
      parentName: converged.name,
    });
    for (const task of deliverable.tasks ?? []) {
      const taskHandle = handleFromLabels(task.labels) ?? undefined;
      identities.push({
        scope: "task",
        sitecoreId: task.id,
        ...(taskHandle ? { handle: taskHandle } : {}),
        name: task.name,
        ...(delHandle ? { parentHandle: delHandle } : {}),
        parentName: deliverable.name,
      });
    }
  }

  return { applied, skipped, identities };
};

/**
 * Resolve a recipe task to its server id within a live deliverable.
 * Matches by `handle:<handle>` label first when the recipe carries a
 * handle, then falls back to name — the same labels-first strategy
 * the deliverable matcher uses.
 */
const resolveTaskId = (deliverable: Deliverable, task: CampaignTask): string => {
  // Server UUID is the strongest identity — resolve by it first so a
  // renamed task's UPDATE still targets the right server item.
  if (task.sitecoreId) {
    const byId = (deliverable.tasks ?? []).find((candidate) => candidate.id === task.sitecoreId);
    if (byId) return byId.id;
  }
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

  // Whole-entity deletion (or fresh create) — resolved by policy via the
  // shared helper: recreate / honor-deletion / surface.
  if (current === null) {
    return resolveMissingCurrentPlan({
      kindName: CAMPAIGN_KIND_NAME,
      ref,
      ctx,
      entityLabel: "Campaign",
      recreate: () => diffCampaign(desired, null),
    });
  }

  let baselinePayload: CampaignBaselinePayload | undefined;
  if (ctx.baselineStorage) {
    const loaded = await ctx.baselineStorage.load<CampaignBaselinePayload>(
      CAMPAIGN_KIND_NAME,
      ctx.environmentName,
      ref.baselineKey ?? ref.id
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
