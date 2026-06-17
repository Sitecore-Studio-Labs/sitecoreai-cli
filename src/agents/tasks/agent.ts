/**
 * `scai agents agent …` — CRUD + run for Agentic Studio agents.
 *
 * Agents are the one Agentic Studio resource with a fully verified write
 * API (`/api/agents` create / update / delete / duplicate), so this is
 * straight imperative CRUD. `create` / `update` take a recipe file
 * (`AgentRecipeSchema`) — the same format `scai agents sync` uses, so a
 * file works with either path.
 */
import { loadRecipe } from "@/sync";
import { createScaiError } from "@/shared/errors";
import {
  createAgent,
  deleteAgent,
  duplicateAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "../api/agents";
import type { Agent } from "../api/schema";
import type { AgentsSession } from "../session/types";
import { runAgent } from "../api/runs";
import { getSpaceArtifacts } from "../api/spaces";
import { AgentRecipeSchema } from "../recipe/agent.schema";
import { buildAgentConfig } from "../recipe/agent.kind";
import {
  prepare,
  renderItem,
  renderList,
  writeAgentsEnvelope,
  type RunAgentsBaseOptions,
} from "./shared";

/** Match an agent by display name, falling back to slug. */
const findByName = (agents: Agent[], name: string): Agent | undefined =>
  agents.find((agent) => agent.name === name || agent.slug === name);

export const runAgentList = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session } = await prepare(options);
  renderList({
    logger,
    command: "agent.list",
    options,
    label: "agent(s)",
    items: await listAgents(session),
    line: (agent: Agent) => `${agent.slug.padEnd(30)} ${agent.name ?? ""}`,
  });
};

export const runAgentGet = async (
  options: RunAgentsBaseOptions & { idOrSlug: string }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const agent = await getAgent(session, options.idOrSlug);
  if (!agent) {
    throw createScaiError(`Agent "${options.idOrSlug}" not found.`, "INPUT_INVALID", {
      hint: "List agents with `scai agents agent list`.",
    });
  }
  renderItem(
    logger,
    "agent.get",
    options,
    `agent "${agent.slug}"`,
    agent as unknown as Record<string, unknown>
  );
};

export const runAgentCreate = async (
  options: RunAgentsBaseOptions & { file: string; whatIf?: boolean }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const recipe = await loadRecipe(options.file, AgentRecipeSchema);
  if (findByName(await listAgents(session), recipe.name)) {
    throw createScaiError(`Agent "${recipe.name}" already exists.`, "INPUT_INVALID", {
      hint: "Use `scai agents agent update` to change it, or pick a different name.",
    });
  }
  if (options.whatIf) {
    if (logger.isJson())
      writeAgentsEnvelope(
        "agent.create",
        options,
        { plan: { create: recipe.name } },
        { whatIf: true }
      );
    else logger.info(`Would create agent "${recipe.name}".`, "yellow");
    return;
  }
  const config = await buildAgentConfig(session, recipe);
  const created = await createAgent(session, {
    name: recipe.name,
    description: recipe.description,
    prompt: recipe.prompt,
    tags: recipe.tags,
    config,
  });
  if (logger.isJson()) writeAgentsEnvelope("agent.create", options, { ok: true, created });
  else logger.info(`Created agent "${recipe.name}".`, "green");
};

export const runAgentUpdate = async (
  options: RunAgentsBaseOptions & { idOrSlug: string; file: string; whatIf?: boolean }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const recipe = await loadRecipe(options.file, AgentRecipeSchema);
  const existing = await getAgent(session, options.idOrSlug);
  if (!existing) {
    throw createScaiError(`Agent "${options.idOrSlug}" not found.`, "INPUT_INVALID", {
      hint: "List agents with `scai agents agent list`.",
    });
  }
  if (options.whatIf) {
    if (logger.isJson())
      writeAgentsEnvelope(
        "agent.update",
        options,
        { plan: { update: existing.id } },
        { whatIf: true }
      );
    else logger.info(`Would update agent "${existing.slug}" (${existing.id}).`, "yellow");
    return;
  }
  const config = await buildAgentConfig(session, recipe);
  await updateAgent(session, {
    id: existing.id,
    name: recipe.name,
    description: recipe.description,
    config,
  });
  if (logger.isJson())
    writeAgentsEnvelope("agent.update", options, { ok: true, updated: existing.id });
  else logger.info(`Updated agent "${recipe.name}".`, "green");
};

export const runAgentDuplicate = async (
  options: RunAgentsBaseOptions & { idOrSlug: string; name: string; whatIf?: boolean }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const existing = await getAgent(session, options.idOrSlug);
  if (!existing) {
    throw createScaiError(`Agent "${options.idOrSlug}" not found.`, "INPUT_INVALID", {
      hint: "List agents with `scai agents agent list`.",
    });
  }
  if (options.whatIf) {
    if (logger.isJson())
      writeAgentsEnvelope(
        "agent.duplicate",
        options,
        { plan: { duplicate: existing.id, as: options.name } },
        { whatIf: true }
      );
    else logger.info(`Would duplicate agent "${existing.slug}" as "${options.name}".`, "yellow");
    return;
  }
  const created = await duplicateAgent(session, existing.id, options.name);
  if (logger.isJson()) writeAgentsEnvelope("agent.duplicate", options, { ok: true, created });
  else logger.info(`Duplicated agent "${existing.slug}" as "${options.name}".`, "green");
};

export const runAgentDelete = async (
  options: RunAgentsBaseOptions & { idOrSlug: string; whatIf?: boolean }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const agent = await getAgent(session, options.idOrSlug);
  if (!agent) {
    throw createScaiError(`Agent "${options.idOrSlug}" not found.`, "INPUT_INVALID");
  }
  if (options.whatIf) {
    if (logger.isJson())
      writeAgentsEnvelope(
        "agent.delete",
        options,
        { plan: { delete: agent.id } },
        { whatIf: true }
      );
    else logger.info(`Would delete agent "${agent.slug}" (${agent.id}).`, "yellow");
    return;
  }
  await deleteAgent(session, agent.id);
  if (logger.isJson())
    writeAgentsEnvelope("agent.delete", options, { ok: true, deleted: agent.id });
  else logger.info(`Deleted agent "${agent.slug}".`, "green");
};

/**
 * Best-effort fetch of a finished run's artifacts (`{ ok, data }` on the
 * run's space). Never throws — a run that streamed fine should not fail
 * just because the artifacts read did.
 */
const collectArtifacts = async (session: AgentsSession, spaceId: string): Promise<unknown> => {
  try {
    return (await getSpaceArtifacts(session, spaceId)).data;
  } catch {
    return undefined;
  }
};

export const runAgentRun = async (
  options: RunAgentsBaseOptions & { agentSlug: string; message: string }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const { spaceId, events } = await runAgent(session, {
    agentSlug: options.agentSlug,
    message: options.message,
  });

  if (logger.isJson()) {
    const collected = [];
    for await (const event of events) collected.push(event);
    writeAgentsEnvelope("agent.run", options, {
      spaceId,
      events: collected,
      artifacts: await collectArtifacts(session, spaceId),
    });
    return;
  }

  logger.info(`Running "${options.agentSlug}" (space ${spaceId})…`, "cyan");
  for await (const event of events) {
    if (event.type === "text-delta" && typeof event.delta === "string") {
      process.stdout.write(event.delta);
    } else if (event.type === "data-artifactDelta") {
      const data = event.data as { content?: string } | undefined;
      if (typeof data?.content === "string") process.stdout.write(data.content);
    }
  }
  process.stdout.write("\n");

  const artifacts = await collectArtifacts(session, spaceId);
  if (artifacts !== undefined && artifacts !== null) {
    logger.info("Run artifacts:", "cyan");
    logger.info(JSON.stringify(artifacts, null, 2));
  }
};
