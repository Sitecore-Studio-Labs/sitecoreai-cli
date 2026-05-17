/**
 * Custom MCPs — external MCP servers registered with Agentic Studio by
 * URL (`/api/custom-mcps`). Once registered and authorized, an agent can
 * use the MCP's tools as additional context.
 *
 * `deleteCustomMcp` uses `DELETE /api/custom-mcps/{id}` — verified working
 * 2026-05-17 against agentic-studio-euw. A custom MCP has **no update**:
 * `PUT /api/custom-mcps/{id}` returns 405, and re-POSTing `/api/custom-mcps`
 * with the same name creates a *duplicate* rather than upserting (both
 * verified 2026-05-17). `updateCustomMcp` stays gated behind `--unverified`;
 * the supported path is delete + recreate. See docs/agentic-studio-har-capture.md.
 */
import { agentsRequest } from "./request";
import type { AgentsSession } from "../session/types";
import type { CustomMcp } from "./schema";

/** List every registered custom MCP server. */
export const listCustomMcps = async (session: AgentsSession): Promise<CustomMcp[]> => {
  const data = await agentsRequest<unknown>(session, "/api/custom-mcps");
  return Array.isArray(data) ? (data as CustomMcp[]) : [];
};

/** Find one custom MCP by `id` or `name`. Returns `undefined` if not found. */
export const getCustomMcp = async (
  session: AgentsSession,
  idOrName: string
): Promise<CustomMcp | undefined> => {
  const mcps = await listCustomMcps(session);
  return mcps.find((mcp) => mcp.id === idOrName || mcp.name === idOrName);
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

export interface UpdateCustomMcpInput extends CreateCustomMcpInput {
  /** Id of the custom MCP to replace. */
  id: string;
}

/**
 * Update a custom MCP (`PUT /api/custom-mcps/{id}`).
 * **UNVERIFIED — returned 405 on 2026-05-17; see the file header.**
 */
export const updateCustomMcp = async (
  session: AgentsSession,
  input: UpdateCustomMcpInput
): Promise<void> => {
  await agentsRequest(session, `/api/custom-mcps/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    body: { name: input.name, url: input.url },
  });
};

/** Delete a custom MCP (`DELETE /api/custom-mcps/{id}`). */
export const deleteCustomMcp = async (session: AgentsSession, id: string): Promise<void> => {
  await agentsRequest(session, `/api/custom-mcps/${encodeURIComponent(id)}`, { method: "DELETE" });
};

/** Read the auth status for a registered MCP (`GET /api/custom-mcps/{id}/auth`). */
export const getCustomMcpAuth = (session: AgentsSession, id: string): Promise<unknown> =>
  agentsRequest<unknown>(session, `/api/custom-mcps/${encodeURIComponent(id)}/auth`);
