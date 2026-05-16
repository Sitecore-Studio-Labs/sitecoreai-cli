/**
 * Spaces — the container a run executes in.
 *
 * A run targets a *space*, not an agent directly. `createSpace` builds a
 * single-agent space and writes its config: the BFF expects the config
 * both in the `POST /api/spaces` body and via a follow-up
 * `PUT /api/spaces/{id}/config` (the order observed in the UI).
 *
 * The space's `launchTarget` is what the run engine actually launches.
 */
import { randomUUID } from "node:crypto";
import { agentsRequest } from "./request";
import type { AgentsSession } from "../session/types";
import type { SpaceConfig } from "./schema";

/** Build a single-agent space config bound to one launch target. */
export const buildSpaceConfig = (
  title: string,
  target: string,
  kind: "agent" | "flow"
): SpaceConfig => ({
  purpose: "custom",
  workPattern: "custom-orchestration",
  spaceName: title,
  globalContext: { objective: "" },
  items: [],
  agents: [{ slug: target, title, instanceId: randomUUID() }],
  agentExecutionMode: "sequential",
  launchTarget: { kind, graphType: target },
});

export interface CreateSpaceInput {
  title: string;
  /** Agent slug (standard agent) or flow id (workflow) to bind and launch. */
  target: string;
  /** Defaults to "agent". */
  targetKind?: "agent" | "flow";
}

export interface CreatedSpace {
  spaceId: string;
  config: SpaceConfig;
}

/** Create a space for one agent/flow and persist its config. */
export const createSpace = async (
  session: AgentsSession,
  input: CreateSpaceInput
): Promise<CreatedSpace> => {
  const spaceId = randomUUID();
  const config = buildSpaceConfig(input.title, input.target, input.targetKind ?? "agent");
  await agentsRequest(session, "/api/spaces", {
    method: "POST",
    body: { id: spaceId, title: input.title, spaceConfig: config },
  });
  await agentsRequest(session, `/api/spaces/${spaceId}/config`, {
    method: "PUT",
    body: { spaceConfig: config },
  });
  return { spaceId, config };
};
