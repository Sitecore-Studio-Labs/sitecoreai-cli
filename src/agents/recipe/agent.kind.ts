/**
 * The `agent` recipe kind — wires Agentic Studio agents into the `sync`
 * engine so they can be pulled, diffed, and pushed declaratively.
 *
 * `ref.id` is the agent's display NAME (recipes identify by name, as
 * `campaign` and `brand-kit` do). `apply` is straight CRUD: `createAgent`
 * when absent, `updateAgent` to converge. Skill *slugs* in the recipe are
 * resolved to skill ids on push and back to slugs on read, so a recipe
 * stays stable across environments.
 */
import { createAgent, listAgents, updateAgent } from "../api/agents";
import { listSkills } from "../api/skills";
import type { Agent, AgentConfig, AgentToolToggles } from "../api/schema";
import { createScaiError } from "@/shared/errors";
import type { ApplyResult, KindRef, RecipeKind, RecipePlan, SyncContext } from "@/sync";
import { resolveAgentsSession } from "./client";
import { diffAgent } from "./agent.diff";
import { AgentRecipeSchema, type AgentRecipe } from "./agent.schema";

/** Match an agent by display name, falling back to slug. */
const findByName = (agents: Agent[], name: string): Agent | undefined =>
  agents.find((agent) => agent.name === name || agent.slug === name);

/** Project a live agent into the clean recipe shape (ids → skill slugs). */
const toAgentRecipe = (agent: Agent, skillIdToSlug: Map<string, string>): AgentRecipe =>
  AgentRecipeSchema.parse({
    name: agent.name ?? agent.slug,
    description: agent.description || undefined,
    prompt: agent.prompt || undefined,
    tags: agent.tags ?? [],
    executionMode: agent.config?.executionMode ?? "standard",
    tools: { ...(agent.config?.tools ?? {}) },
    skills: (agent.config?.skills ?? []).map((id) => skillIdToSlug.get(id) ?? id),
    output: agent.config?.output ?? { format: "text" },
  });

/** Build an `AgentConfig` from a recipe (skill slugs → ids). */
const toAgentConfig = (recipe: AgentRecipe, skillSlugToId: Map<string, string>): AgentConfig => ({
  executionMode: recipe.executionMode,
  tools: recipe.tools as AgentToolToggles,
  defaultContext: [],
  skills: recipe.skills.map((slug) => skillSlugToId.get(slug) ?? slug),
  output: recipe.output,
});

/** Capture a live agent as a recipe. `null` when no agent has the name. */
const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<AgentRecipe | null> => {
  const session = await resolveAgentsSession(ctx);
  const agent = findByName(await listAgents(session), ref.id);
  if (!agent) return null;
  const skills = await listSkills(session);
  const skillIdToSlug = new Map(skills.map((skill) => [skill.id, skill.slug]));
  return toAgentRecipe(agent, skillIdToSlug);
};

/** Compute the plan to converge an agent onto `desired`. */
const plan = async (desired: AgentRecipe, ref: KindRef, ctx: SyncContext): Promise<RecipePlan> =>
  diffAgent(desired, await readCurrent(ref, ctx));

/** Apply a plan — create the agent when absent, otherwise update it. */
const apply = async (
  recipePlan: RecipePlan,
  ref: KindRef,
  ctx: SyncContext
): Promise<ApplyResult> => {
  const change = recipePlan.changes[0];
  if (!change || change.kind === "noop") {
    return { applied: [], skipped: change ? [change] : [] };
  }

  const session = await resolveAgentsSession(ctx);
  const recipe =
    (change.meta?.recipe as AgentRecipe | undefined) ?? AgentRecipeSchema.parse(change.after);
  const skills = await listSkills(session);
  const skillSlugToId = new Map(skills.map((skill) => [skill.slug, skill.id]));
  const config = toAgentConfig(recipe, skillSlugToId);

  if (change.kind === "create") {
    ctx.logger?.info(`Creating agent "${recipe.name}".`);
    await createAgent(session, {
      name: recipe.name,
      description: recipe.description,
      prompt: recipe.prompt,
      tags: recipe.tags,
      config,
    });
    return { applied: [change], skipped: [] };
  }

  // update — resolve the live agent id by name
  const existing = findByName(await listAgents(session), ref.id);
  if (!existing) {
    throw createScaiError(`Agent "${ref.id}" not found`, "INPUT_INVALID", {
      hint: "Push a recipe that creates the agent, or check the name.",
    });
  }
  ctx.logger?.info(`Updating agent "${recipe.name}".`);
  await updateAgent(session, {
    id: existing.id,
    name: recipe.name,
    description: recipe.description,
    config,
  });
  return { applied: [change], skipped: [] };
};

/** The `agent` recipe kind. */
export const agentKind: RecipeKind<AgentRecipe> = {
  name: "agent",
  schema: AgentRecipeSchema,
  readCurrent,
  plan,
  apply,
};
