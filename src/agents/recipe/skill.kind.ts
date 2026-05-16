/**
 * The `skill` recipe kind — declarative Agentic Studio skills.
 *
 * Create-only: `POST /api/skills` is verified but no update endpoint is,
 * so an existing skill is left untouched (see `diffCreateOnly`). `ref.id`
 * is the skill's display name.
 */
import { createSkill, listSkills } from "../api/skills";
import type { Skill } from "../api/schema";
import type { ApplyResult, KindRef, RecipeKind, RecipePlan, SyncContext } from "@/sync";
import { resolveAgentsSession } from "./client";
import { diffCreateOnly } from "./converge";
import { SkillRecipeSchema, type SkillRecipe } from "./skill.schema";

const findByName = (skills: Skill[], name: string): Skill | undefined =>
  skills.find((skill) => skill.name === name || skill.slug === name);

const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<SkillRecipe | null> => {
  const session = await resolveAgentsSession(ctx);
  const skill = findByName(await listSkills(session), ref.id);
  if (!skill) return null;
  return SkillRecipeSchema.parse({
    name: skill.name,
    description: skill.description,
    content: skill.content ?? "",
    tags: skill.tags ?? [],
    visibility: skill.visibility ?? "team",
  });
};

const plan = async (desired: SkillRecipe, ref: KindRef, ctx: SyncContext): Promise<RecipePlan> =>
  diffCreateOnly("skill", desired.name, desired, await readCurrent(ref, ctx));

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
    (change.meta?.recipe as SkillRecipe | undefined) ?? SkillRecipeSchema.parse(change.after);
  ctx.logger?.info(`Creating skill "${recipe.name}".`);
  await createSkill(session, recipe);
  return { applied: [change], skipped: [] };
};

/** The `skill` recipe kind. */
export const skillKind: RecipeKind<SkillRecipe> = {
  name: "skill",
  schema: SkillRecipeSchema,
  readCurrent,
  plan,
  apply,
};
