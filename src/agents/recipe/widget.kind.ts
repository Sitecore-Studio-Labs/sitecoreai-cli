/**
 * The `widget` recipe kind — declarative Agentic Studio widgets.
 *
 * Create-only: `POST /api/widgets` is verified, update is not. `ref.id`
 * is the widget's display name.
 */
import { createWidget, listWidgets } from "../api/widgets";
import type { Widget } from "../api/schema";
import type { ApplyResult, KindRef, RecipeKind, RecipePlan, SyncContext } from "@/sync";
import { resolveAgentsSession } from "./client";
import { diffCreateOnly } from "./converge";
import { WidgetRecipeSchema, type WidgetRecipe } from "./widget.schema";

const findByName = (widgets: Widget[], name: string): Widget | undefined =>
  widgets.find((widget) => widget.name === name);

const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<WidgetRecipe | null> => {
  const session = await resolveAgentsSession(ctx);
  const widget = findByName(await listWidgets(session), ref.id);
  if (!widget) return null;
  return WidgetRecipeSchema.parse({
    name: widget.name,
    description: widget.description ?? undefined,
    spec: widget.spec ?? { root: "", elements: {} },
  });
};

const plan = async (desired: WidgetRecipe, ref: KindRef, ctx: SyncContext): Promise<RecipePlan> =>
  diffCreateOnly("widget", desired.name, desired, await readCurrent(ref, ctx));

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
    (change.meta?.recipe as WidgetRecipe | undefined) ?? WidgetRecipeSchema.parse(change.after);
  ctx.logger?.info(`Creating widget "${recipe.name}".`);
  await createWidget(session, {
    name: recipe.name,
    description: recipe.description ?? null,
    spec: recipe.spec,
  });
  return { applied: [change], skipped: [] };
};

/** The `widget` recipe kind. */
export const widgetKind: RecipeKind<WidgetRecipe> = {
  name: "widget",
  schema: WidgetRecipeSchema,
  readCurrent,
  plan,
  apply,
};
