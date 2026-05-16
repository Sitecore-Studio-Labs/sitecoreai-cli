/**
 * Agent CRUD against the Agentic Studio BFF (`/api/agents`).
 *
 * `POST /api/agents` returns a single-element array `[{agent}]` — every
 * create/duplicate unwraps it. There is no confirmed `GET /api/agents/{id}`,
 * so `getAgent` filters the list instead.
 */
import { agentsRequest } from "./request";
import type { AgentsSession } from "../session/types";
import type { Agent, AgentConfig } from "./schema";

const unwrapAgent = (value: unknown): Agent => {
  const agent = Array.isArray(value) ? value[0] : value;
  return agent as Agent;
};

/** List every agent (predefined + custom) visible to the session. */
export const listAgents = async (session: AgentsSession): Promise<Agent[]> => {
  const data = await agentsRequest<unknown>(session, "/api/agents");
  return Array.isArray(data) ? (data as Agent[]) : [];
};

/** Find one agent by `id` or `slug`. Returns `undefined` if not found. */
export const getAgent = async (
  session: AgentsSession,
  idOrSlug: string
): Promise<Agent | undefined> => {
  const agents = await listAgents(session);
  return agents.find((agent) => agent.id === idOrSlug || agent.slug === idOrSlug);
};

export interface CreateAgentInput {
  name: string;
  description?: string;
  prompt?: string;
  tags?: string[];
  config: AgentConfig;
}

/** Create a custom agent. Requires the caller's account to hold the Builder role. */
export const createAgent = async (
  session: AgentsSession,
  input: CreateAgentInput
): Promise<Agent> => {
  const data = await agentsRequest<unknown>(session, "/api/agents", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description ?? "",
      prompt: input.prompt ?? "",
      tags: input.tags ?? [],
      config: input.config,
      isPredefined: false,
    },
  });
  return unwrapAgent(data);
};

export interface UpdateAgentInput {
  id: string;
  name: string;
  description?: string;
  config: AgentConfig;
}

/** Update an agent in place (`PUT /api/agents`, full-replacement of config). */
export const updateAgent = async (
  session: AgentsSession,
  input: UpdateAgentInput
): Promise<void> => {
  await agentsRequest(session, "/api/agents", {
    method: "PUT",
    body: {
      id: input.id,
      name: input.name,
      description: input.description ?? "",
      config: input.config,
    },
  });
};

/** Duplicate an agent under a new name (`POST /api/agents/{id}`). */
export const duplicateAgent = async (
  session: AgentsSession,
  id: string,
  name: string
): Promise<Agent> => {
  const data = await agentsRequest<unknown>(session, `/api/agents/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { name },
  });
  return unwrapAgent(data);
};

/** Delete an agent (`DELETE /api/agents/{id}`). */
export const deleteAgent = async (session: AgentsSession, id: string): Promise<void> => {
  await agentsRequest(session, `/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
};
