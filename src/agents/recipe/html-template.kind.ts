/**
 * The `html-template` recipe kind — declarative Agentic Studio HTML
 * templates.
 *
 * Create-only: html-template creation goes through the
 * `/html-templates/create` Next.js server action (no `/api/` write
 * endpoint, no update) — see `api/html-templates.ts`. An existing
 * template is left untouched.
 */
import { createHtmlTemplate, listHtmlTemplates } from "../api/html-templates";
import type { HtmlTemplate } from "../api/schema";
import type { ApplyResult, KindRef, RecipeKind, RecipePlan, SyncContext } from "@/sync";
import { resolveAgentsSession } from "./client";
import { diffCreateOnly } from "./converge";
import { HtmlTemplateRecipeSchema, type HtmlTemplateRecipe } from "./html-template.schema";

const findByName = (templates: HtmlTemplate[], name: string): HtmlTemplate | undefined =>
  templates.find((template) => template.name === name || template.templateId === name);

const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<HtmlTemplateRecipe | null> => {
  const session = await resolveAgentsSession(ctx);
  const found = findByName(await listHtmlTemplates(session), ref.id);
  if (!found) return null;
  return HtmlTemplateRecipeSchema.parse({
    name: found.name ?? found.templateId ?? ref.id,
    code: found.code ?? "",
    description: found.description,
    tags: found.tags ?? [],
  });
};

const plan = async (
  desired: HtmlTemplateRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> =>
  diffCreateOnly("html-template", desired.name, desired, await readCurrent(ref, ctx));

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
    (change.meta?.recipe as HtmlTemplateRecipe | undefined) ??
    HtmlTemplateRecipeSchema.parse(change.after);
  ctx.logger?.info(`Creating HTML template "${recipe.name}".`);
  await createHtmlTemplate(session, recipe);
  return { applied: [change], skipped: [] };
};

/** The `html-template` recipe kind. */
export const htmlTemplateKind: RecipeKind<HtmlTemplateRecipe> = {
  name: "html-template",
  schema: HtmlTemplateRecipeSchema,
  readCurrent,
  plan,
  apply,
};
