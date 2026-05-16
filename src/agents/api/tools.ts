/**
 * Tools — the platform tool catalog (`/api/tools`).
 *
 * Tools are NOT user-created: they are a fixed catalog (the `enableAgentApi*`
 * Agent-API domains, plus context MCPs and standard tools). An agent opts
 * into them via its `config.tools` toggles. Admin enable/disable goes
 * through `PATCH /api/tools/{toolKey}` — out of scope here until needed.
 */
import { agentsRequest } from "./request";
import type { AgentsSession } from "../session/types";
import type { Tool } from "./schema";

/** List the tool catalog. `category` is agent_api | context | standard. */
export const listTools = async (session: AgentsSession): Promise<Tool[]> => {
  const data = await agentsRequest<unknown>(session, "/api/tools");
  return Array.isArray(data) ? (data as Tool[]) : [];
};
