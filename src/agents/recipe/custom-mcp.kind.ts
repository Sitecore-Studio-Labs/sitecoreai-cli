/**
 * The `custom-mcp` recipe kind — declarative external MCP registrations.
 *
 * Create-only: `POST /api/custom-mcps` is verified, update is not.
 * `ref.id` is the MCP's display name.
 */
import { createCustomMcp, listCustomMcps } from "../api/custom-mcps";
import type { CustomMcp } from "../api/schema";
import type { ApplyResult, KindRef, RecipeKind, RecipePlan, SyncContext } from "@/sync";
import { resolveAgentsSession } from "./client";
import { diffCreateOnly } from "./converge";
import { CustomMcpRecipeSchema, type CustomMcpRecipe } from "./custom-mcp.schema";

const findByName = (mcps: CustomMcp[], name: string): CustomMcp | undefined =>
  mcps.find((mcp) => mcp.name === name);

const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<CustomMcpRecipe | null> => {
  const session = await resolveAgentsSession(ctx);
  const mcp = findByName(await listCustomMcps(session), ref.id);
  if (!mcp) return null;
  return CustomMcpRecipeSchema.parse({ name: mcp.name, url: mcp.url });
};

const plan = async (
  desired: CustomMcpRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> =>
  diffCreateOnly("custom-mcp", desired.name, desired, await readCurrent(ref, ctx));

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
    (change.meta?.recipe as CustomMcpRecipe | undefined) ??
    CustomMcpRecipeSchema.parse(change.after);
  ctx.logger?.info(`Registering custom MCP "${recipe.name}".`);
  await createCustomMcp(session, recipe);
  return { applied: [change], skipped: [] };
};

/** The `custom-mcp` recipe kind. */
export const customMcpKind: RecipeKind<CustomMcpRecipe> = {
  name: "custom-mcp",
  schema: CustomMcpRecipeSchema,
  readCurrent,
  plan,
  apply,
};
