/**
 * Custom MCPs — external MCP servers registered with Agentic Studio by
 * URL (`/api/custom-mcps`). Once registered and authorized, an agent can
 * use the MCP's tools as additional context.
 */
import { agentsRequest } from "./request";
import type { AgentsSession } from "../session/types";
import type { CustomMcp } from "./schema";

/** List every registered custom MCP server. */
export const listCustomMcps = async (session: AgentsSession): Promise<CustomMcp[]> => {
  const data = await agentsRequest<unknown>(session, "/api/custom-mcps");
  return Array.isArray(data) ? (data as CustomMcp[]) : [];
};

export interface CreateCustomMcpInput {
  name: string;
  /** The MCP server endpoint URL. */
  url: string;
}

/** Register a custom MCP server (`POST /api/custom-mcps`). */
export const createCustomMcp = async (
  session: AgentsSession,
  input: CreateCustomMcpInput
): Promise<CustomMcp> =>
  agentsRequest<CustomMcp>(session, "/api/custom-mcps", {
    method: "POST",
    body: { name: input.name, url: input.url },
  });

/** Read the auth status for a registered MCP (`GET /api/custom-mcps/{id}/auth`). */
export const getCustomMcpAuth = (session: AgentsSession, id: string): Promise<unknown> =>
  agentsRequest<unknown>(session, `/api/custom-mcps/${encodeURIComponent(id)}/auth`);
