/**
 * The `brief` recipe kind — wires the Sitecore Content Operations
 * Brief instance API into the `sync` engine.
 *
 * `ref.id` is the brief's display NAME — recipes identify a brief by
 * name, not UUID, mirroring how `campaign` identifies a project. The
 * brief type is referenced by its stable codename (`briefTypeName`)
 * and resolved to a server id at push-time via `listBriefTypes`.
 *
 * `apply` is straight CRUD: `createBrief` when the brief is absent,
 * `updateBrief` (partial PUT) to converge an existing one. Repointing
 * an existing brief at a different brief type is refused — the Brief
 * API has no verified path for that.
 *
 * See docs/recipe-sync-architecture.md.
 */
import {
  createBrief,
  getBrief,
  listBriefTypes,
  listBriefs,
  updateBrief,
  type Brief,
  type BriefApiClientOptions,
  type BriefStatus,
  type BriefType,
  type CreateBriefInput,
} from "@/brief";
import { createScaiError } from "@/shared/errors";
import type {
  ApplyResult,
  KindRef,
  RecipeChange,
  RecipeKind,
  RecipePlan,
  SyncContext,
} from "@/sync";
import { resolveBriefClient } from "./client";
import { diffBriefInstance } from "./instance-diff";
import { BriefInstanceRecipeSchema, type BriefInstanceRecipe } from "./instance-schema";

/**
 * Find a brief by its display name, paging the list endpoint until a
 * match is found or the cursor is exhausted. The Brief list endpoint
 * supports no server-side name filter (see `ListBriefsQuery`), so the
 * walk is unavoidable.
 */
const findBriefByName = async (
  client: BriefApiClientOptions,
  name: string
): Promise<Brief | null> => {
  let cursor: string | undefined;
  for (;;) {
    const page = await listBriefs(client, cursor ? { next: cursor } : undefined);
    const match = page.data.find((brief) => brief.name === name);
    if (match) return match;
    if (!page.next || page.data.length === 0) return null;
    cursor = page.next;
  }
};

/** Find a brief type by its codename (mirrors `briefTypeKind`'s helper). */
const findTypeByName = async (
  client: BriefApiClientOptions,
  name: string
): Promise<BriefType | null> => {
  const page = await listBriefTypes(client);
  return page.data.find((type) => type.name === name) ?? null;
};

/** Enumerate every brief on the remote — fans out into the aggregate sync. */
const list = async (ctx: SyncContext): Promise<KindRef[]> => {
  const client = await resolveBriefClient(ctx);
  const refs: KindRef[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listBriefs(client, cursor ? { next: cursor } : undefined);
    for (const brief of page.data) {
      refs.push({ kind: "brief", id: brief.name });
    }
    if (!page.next || page.data.length === 0) return refs;
    cursor = page.next;
  }
};

/** Project a live brief into the recipe shape, dropping server ids/metadata. */
const toRecipe = (brief: Brief, briefTypeName: string): BriefInstanceRecipe => ({
  name: brief.name,
  briefTypeName,
  locale: brief.locale || undefined,
  status: brief.status,
  isTemplate: brief.isTemplate,
  fields: brief.fields ?? {},
});

/**
 * Capture a live brief as a recipe. `null` when no brief has the name.
 *
 * The list endpoint omits the full nested `fields` map on some
 * envelopes, so the matched id is re-read via `getBrief` for fidelity.
 */
const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<BriefInstanceRecipe | null> => {
  const client = await resolveBriefClient(ctx);
  const found = await findBriefByName(client, ref.id);
  if (!found) return null;
  const brief = await getBrief(client, found.id);

  // Resolve the brief-type codename. The brief carries a `Link` to its
  // type with the id but not the codename, so a follow-up listTypes
  // resolves it. If the type has been deleted (orphan brief), surface
  // the id verbatim so the pulled recipe still round-trips.
  const types = await listBriefTypes(client);
  const briefTypeName =
    types.data.find((type) => type.id === brief.briefType.id)?.name ?? brief.briefType.id;

  return toRecipe(brief, briefTypeName);
};

/** Resolve a recipe's `briefTypeName` to its server id, or fail with a hint. */
const resolveBriefTypeId = async (
  client: BriefApiClientOptions,
  briefTypeName: string
): Promise<string> => {
  const type = await findTypeByName(client, briefTypeName);
  if (!type) {
    throw createScaiError(`Brief type "${briefTypeName}" not found.`, "INPUT_INVALID", {
      hint: "Push the brief-type recipe first, or check the `briefTypeName` codename with `scai ops brief types list`.",
    });
  }
  return type.id;
};

/** Apply a plan — create the brief, or PUT-patch it onto the desired state. */
const apply = async (plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult> => {
  const client = await resolveBriefClient(ctx);
  const applied: RecipeChange[] = [];
  const skipped: RecipeChange[] = [];

  // The single `stage: "instance"` change carries the full desired
  // recipe; per-element `stage: "field"` changes are descriptive only.
  const instanceChange = plan.changes.find((change) => change.meta?.stage === "instance");
  if (!instanceChange) {
    // Nothing to write — an all-noop plan.
    for (const change of plan.changes) skipped.push(change);
    return { applied, skipped };
  }

  const recipe = instanceChange.meta?.recipe as BriefInstanceRecipe | undefined;
  if (!recipe) {
    throw createScaiError("Brief plan change is missing its recipe payload.", "INPUT_INVALID", {
      hint: "This is an internal diff error — change.meta.recipe was not set.",
    });
  }

  if (instanceChange.kind === "create") {
    const briefTypeId = await resolveBriefTypeId(client, recipe.briefTypeName);
    const input: CreateBriefInput = {
      name: recipe.name,
      briefTypeId,
      ...(recipe.locale !== undefined && { locale: recipe.locale }),
      ...(Object.keys(recipe.fields ?? {}).length > 0 && { fields: recipe.fields }),
      ...(recipe.isTemplate !== undefined && { isTemplate: recipe.isTemplate }),
    };
    ctx.logger?.info(`Creating brief "${recipe.name}".`);
    const created = await createBrief(client, input);

    // `createBrief` accepts no `status` field — POSTs land in the
    // server default ("Draft"). If the recipe pins a different status,
    // converge with a follow-up PUT so the post-apply state matches.
    if (recipe.status && recipe.status !== created.status) {
      ctx.logger?.info(`Setting brief "${recipe.name}" status to "${recipe.status}".`);
      await updateBrief(client, created.id, { status: recipe.status });
    }
  } else {
    const existing = await findBriefByName(client, ref.id);
    if (!existing) {
      throw createScaiError(`Brief "${ref.id}" not found.`, "INPUT_INVALID", {
        hint: "The brief was expected to exist for an update — check the name or push a create.",
      });
    }
    // The Brief API has no verified path to repoint a brief at a
    // different type. Surface that loudly instead of silently dropping
    // the change.
    const types = await listBriefTypes(client);
    const existingTypeName =
      types.data.find((type) => type.id === existing.briefType.id)?.name ?? existing.briefType.id;
    if (existingTypeName !== recipe.briefTypeName) {
      throw createScaiError(
        `Cannot repoint brief "${recipe.name}" from type "${existingTypeName}" to "${recipe.briefTypeName}".`,
        "INPUT_INVALID",
        {
          hint: "The Brief API has no verified path to change a brief's type. Delete and recreate the brief, or correct the recipe's briefTypeName.",
        }
      );
    }
    const patch: Partial<CreateBriefInput> & { status?: BriefStatus } = {
      name: recipe.name,
      ...(recipe.locale !== undefined && { locale: recipe.locale }),
      ...(recipe.isTemplate !== undefined && { isTemplate: recipe.isTemplate }),
      ...(recipe.status !== undefined && { status: recipe.status }),
      fields: recipe.fields ?? {},
    };
    ctx.logger?.info(`Updating brief "${recipe.name}" (${existing.id}).`);
    await updateBrief(client, existing.id, patch);
  }
  applied.push(instanceChange);

  // Per-element changes are converged by the single PUT (or POST).
  for (const change of plan.changes) {
    if (change === instanceChange) continue;
    if (change.kind === "noop") skipped.push(change);
    else applied.push(change);
  }

  return { applied, skipped };
};

/** Compute the plan to converge a brief onto `desired`. */
const plan = async (
  desired: BriefInstanceRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> => diffBriefInstance(desired, await readCurrent(ref, ctx));

/** The `brief` recipe kind. */
export const briefInstanceKind: RecipeKind<BriefInstanceRecipe> = {
  name: "brief",
  schema: BriefInstanceRecipeSchema,
  readCurrent,
  plan,
  apply,
  list,
};
