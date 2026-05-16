/**
 * The `schema` recipe kind — declarative Agentic Studio structured-output
 * schemas.
 *
 * Create-only: schema creation goes through the `/schemas/create` Next.js
 * server action (no `/api/` write endpoint, no update) — see
 * `api/schemas.ts`. An existing schema is left untouched.
 */
import { createSchema, listSchemas } from "../api/schemas";
import type { StructuredSchema } from "../api/schema";
import type { ApplyResult, KindRef, RecipeKind, RecipePlan, SyncContext } from "@/sync";
import { resolveAgentsSession } from "./client";
import { diffCreateOnly } from "./converge";
import { SchemaRecipeSchema, type SchemaRecipe } from "./schema.schema";

const findByName = (schemas: StructuredSchema[], name: string): StructuredSchema | undefined =>
  schemas.find((schema) => schema.name === name);

const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<SchemaRecipe | null> => {
  const session = await resolveAgentsSession(ctx);
  const found = findByName(await listSchemas(session), ref.id);
  if (!found) return null;
  const fields = found.fields as { schema?: Record<string, unknown>; strict?: boolean } | undefined;
  return SchemaRecipeSchema.parse({
    name: found.name,
    description: found.description,
    schema: fields?.schema ?? {},
    strict: fields?.strict ?? true,
    tags: found.tags ?? [],
  });
};

const plan = async (desired: SchemaRecipe, ref: KindRef, ctx: SyncContext): Promise<RecipePlan> =>
  diffCreateOnly("schema", desired.name, desired, await readCurrent(ref, ctx));

const apply = async (
  recipePlan: RecipePlan,
  _ref: KindRef,
  ctx: SyncContext
): Promise<ApplyResult> => {
  const change = recipePlan.changes[0];
  if (!change || change.kind !== "create") {
    return { applied: [], skipped: change ? [change] : [] };
  }
  const session = await resolveAgentsSession(ctx);
  const recipe =
    (change.meta?.recipe as SchemaRecipe | undefined) ?? SchemaRecipeSchema.parse(change.after);
  ctx.logger?.info(`Creating schema "${recipe.name}".`);
  await createSchema(session, recipe);
  return { applied: [change], skipped: [] };
};

/** The `schema` recipe kind. */
export const schemaKind: RecipeKind<SchemaRecipe> = {
  name: "schema",
  schema: SchemaRecipeSchema,
  readCurrent,
  plan,
  apply,
};
