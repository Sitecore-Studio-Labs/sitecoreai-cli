/**
 * Runs — trigger an agent/flow and consume its Server-Sent event stream.
 *
 * `POST /api/chatv2` streams `text/event-stream`. `parseRunEvents` turns
 * the raw chunks into typed `RunEvent`s; `streamRun` issues a run against
 * an existing space; `runAgent` is the convenience that creates a space
 * first. The chatv2 `graphType` selects the target — an agent slug runs a
 * standard agent, a flow id runs a workflow.
 */
import { randomUUID } from "node:crypto";
import { agentsStream } from "./request";
import { createSpace } from "./spaces";
import type { AgentsSession } from "../session/types";
import type { RunEvent } from "./schema";

/** Parse a stream of raw SSE text chunks into typed run events. */
export async function* parseRunEvents(chunks: AsyncIterable<string>): AsyncIterable<RunEvent> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk.replace(/\r\n/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as RunEvent;
          if (event && typeof event.type === "string") yield event;
        } catch {
          /* skip an unparseable frame rather than abort the run */
        }
      }
    }
  }
}

export interface StreamRunInput {
  spaceId: string;
  /** chatv2 `graphType` — an agent slug (standard) or flow id (workflow). */
  graphType: string;
  message: string;
  signal?: AbortSignal;
}

/** Trigger a run against an existing space and yield its events. */
export const streamRun = (session: AgentsSession, input: StreamRunInput): AsyncIterable<RunEvent> =>
  parseRunEvents(
    agentsStream(session, "/api/chatv2", {
      method: "POST",
      signal: input.signal,
      body: {
        id: input.spaceId,
        agentType: "agent",
        message: {
          role: "user",
          parts: [{ type: "text", text: input.message }],
          id: randomUUID(),
        },
        selectedVisibilityType: "private",
        graphType: input.graphType,
      },
    })
  );

export interface RunAgentInput {
  /** Slug of the agent to run. */
  agentSlug: string;
  message: string;
  /** Space title — defaults to a generated one. */
  title?: string;
  signal?: AbortSignal;
}

export interface RunHandle {
  /** The space created for this run (spaces have no delete endpoint). */
  spaceId: string;
  events: AsyncIterable<RunEvent>;
}

/**
 * Create a space for an agent and stream a run against it. Each call
 * creates a new space — they accumulate, the BFF exposes no space delete.
 */
export const runAgent = async (
  session: AgentsSession,
  input: RunAgentInput
): Promise<RunHandle> => {
  const title = input.title ?? `scai run — ${input.agentSlug}`;
  const { spaceId } = await createSpace(session, {
    title,
    target: input.agentSlug,
    targetKind: "agent",
  });
  return {
    spaceId,
    events: streamRun(session, {
      spaceId,
      graphType: input.agentSlug,
      message: input.message,
      signal: input.signal,
    }),
  };
};
