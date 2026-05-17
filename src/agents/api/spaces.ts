/**
 * Spaces — the container a run executes in.
 *
 * A run targets a *space*, not an agent directly. `createSpace` builds a
 * single-agent space and writes its config: the BFF expects the config
 * both in the `POST /api/spaces` body and via a follow-up
 * `PUT /api/spaces/{id}/config` (the order observed in the UI).
 *
 * The space's `launchTarget` is what the run engine actually launches.
 *
 * Verified 2026-05-17 (agentic-studio-euw): a space has no list or delete
 * endpoint (`GET /api/spaces` → 405, `GET`/`DELETE /api/spaces/{id}` →
 * 404), but `/config` and `/artifacts` are readable and `/config` is
 * writable — so a space can be read, renamed, and have its agents /
 * context changed, just not enumerated or deleted.
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

/** Read a space's stored config (`GET /api/spaces/{id}/config`). */
export const getSpaceConfig = async (
  session: AgentsSession,
  spaceId: string
): Promise<SpaceConfig> => {
  const data = await agentsRequest<{ spaceConfig?: SpaceConfig }>(
    session,
    `/api/spaces/${encodeURIComponent(spaceId)}/config`
  );
  return (data?.spaceConfig ?? {}) as SpaceConfig;
};

/** A space's run artifacts — the structured results of its agent runs. */
export interface SpaceArtifacts {
  ok?: boolean;
  /** The artifact payload; shape is run-specific and parsed defensively. */
  data?: unknown;
  [key: string]: unknown;
}

/** Read a space's run artifacts / output (`GET /api/spaces/{id}/artifacts`). */
export const getSpaceArtifacts = async (
  session: AgentsSession,
  spaceId: string
): Promise<SpaceArtifacts> => {
  const data = await agentsRequest<SpaceArtifacts>(
    session,
    `/api/spaces/${encodeURIComponent(spaceId)}/artifacts`
  );
  return data ?? {};
};

/**
 * Replace a space's config (`PUT /api/spaces/{id}/config`). The BFF has no
 * space delete; rewriting the config is how a space is renamed or has its
 * agents / global context changed.
 */
export const updateSpaceConfig = async (
  session: AgentsSession,
  spaceId: string,
  config: SpaceConfig
): Promise<void> => {
  await agentsRequest(session, `/api/spaces/${encodeURIComponent(spaceId)}/config`, {
    method: "PUT",
    body: { spaceConfig: config },
  });
};
