/**
 * The `brief-type` recipe kind — wires the Sitecore Content Operations
 * Brief API into the `sync` engine.
 *
 * `ref.id` is the brief type's NAME (its stable codename) — recipes
 * identify a type by name, not UUID. `readCurrent` resolves it to a live
 * brief type; `apply` is straight CRUD: `createBriefType` when the type
 * is absent, `updateBriefType` (full-replacement PUT) to converge an
 * existing one. Brief types have no ingestion/pipeline/orchestration,
 * unlike brand kits — `apply` stays simple.
 *
 * See docs/recipe-sync-architecture.md.
 */
import {
  createBriefType,
  listBriefTypes,
  updateBriefType,
  type BriefApiClientOptions,
  type BriefField,
  type BriefType,
  type CreateBriefTypeInput,
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
import { diffBriefType } from "./diff";
import { BriefTypeRecipeSchema, type BriefRecipeField, type BriefTypeRecipe } from "./schema";

/** Find a brief type by its codename. `null` when none matches. */
const findTypeByName = async (
  client: BriefApiClientOptions,
  name: string
): Promise<BriefType | null> => {
  const page = await listBriefTypes(client);
  return page.data.find((type) => type.name === name) ?? null;
};

/** Enumerate every brief type on the remote. */
const list = async (ctx: SyncContext): Promise<KindRef[]> => {
  const client = await resolveBriefClient(ctx);
  const page = await listBriefTypes(client);
  return page.data.map((type) => ({ kind: "brief-type", id: type.name }));
};

/** Project a live brief-type field into the clean recipe shape. */
const toRecipeField = (field: BriefField): BriefRecipeField => field as BriefRecipeField;

/** Project a live brief type into the recipe shape, dropping server ids. */
const toRecipe = (type: BriefType): BriefTypeRecipe => ({
  name: type.name,
  label: type.label,
  description: type.description,
  icon: type.icon,
  iconColor: type.iconColor,
  fields: type.fields.map(toRecipeField),
});

/** Convert a recipe into the Brief API's create/update write shape. */
const toApiInput = (recipe: BriefTypeRecipe): CreateBriefTypeInput => ({
  name: recipe.name,
  label: recipe.label,
  description: recipe.description,
  icon: recipe.icon,
  iconColor: recipe.iconColor,
  fields: recipe.fields as BriefField[],
});

/** Capture a live brief type as a recipe. `null` when no type has the name. */
const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<BriefTypeRecipe | null> => {
  const client = await resolveBriefClient(ctx);
  const type = await findTypeByName(client, ref.id);
  return type ? toRecipe(type) : null;
};

/** Apply a plan — straight CRUD: create the type, or PUT-replace it. */
const apply = async (plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult> => {
  const client = await resolveBriefClient(ctx);
  const applied: RecipeChange[] = [];
  const skipped: RecipeChange[] = [];

  // The single `stage: "type"` change carries the full desired recipe;
  // per-element `stage: "field"` changes are descriptive only.
  const typeChange = plan.changes.find((change) => change.meta?.stage === "type");
  if (!typeChange) {
    // Nothing to write — an all-noop plan.
    for (const change of plan.changes) skipped.push(change);
    return { applied, skipped };
  }

  const recipe = typeChange.meta?.recipe as BriefTypeRecipe | undefined;
  if (!recipe) {
    throw createScaiError(
      "Brief-type plan change is missing its recipe payload.",
      "INPUT_INVALID",
      { hint: "This is an internal diff error — the change.meta.recipe field was not set." }
    );
  }
  const input = toApiInput(recipe);

  if (typeChange.kind === "create") {
    ctx.logger?.info(`Creating brief type "${recipe.name}".`);
    await createBriefType(client, input);
  } else {
    const existing = await findTypeByName(client, ref.id);
    if (!existing) {
      throw createScaiError(`Brief type "${ref.id}" not found.`, "INPUT_INVALID", {
        hint: "The type was expected to exist for an update — check the name or push a create.",
      });
    }
    ctx.logger?.info(`Updating brief type "${recipe.name}" (${existing.id}).`);
    await updateBriefType(client, existing.id, input);
  }
  applied.push(typeChange);

  // Per-element changes are converged by the single whole-record write.
  for (const change of plan.changes) {
    if (change === typeChange) continue;
    if (change.kind === "noop") skipped.push(change);
    else applied.push(change);
  }

  return { applied, skipped };
};

/** Compute the plan to converge a brief type onto `desired`. */
const plan = async (
  desired: BriefTypeRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> => diffBriefType(desired, await readCurrent(ref, ctx));

/** The `brief-type` recipe kind. */
export const briefTypeKind: RecipeKind<BriefTypeRecipe> = {
  name: "brief-type",
  schema: BriefTypeRecipeSchema,
  readCurrent,
  plan,
  apply,
  list,
};
