/**
 * Widgets — configurable report/dashboard surfaces (`/api/widgets`).
 *
 * A widget carries a declarative `spec` (a tree of typed UI elements).
 * `generateWidgetSpec` is the AI-assisted authoring helper: it streams
 * JSON-Patch ops that build a spec up from a prompt.
 *
 * `updateWidget` / `deleteWidget` use `PUT`/`DELETE /api/widgets/{id}` —
 * verified working 2026-05-17 against agentic-studio-euw.
 */
import { agentsRequest, agentsStream } from "./request";
import type { AgentsSession } from "../session/types";
import type { Widget, WidgetSpec } from "./schema";

/** List every widget visible to the session. */
export const listWidgets = async (session: AgentsSession): Promise<Widget[]> => {
  const data = await agentsRequest<unknown>(session, "/api/widgets");
  return Array.isArray(data) ? (data as Widget[]) : [];
};

/** Find one widget by `id` or `name`. Returns `undefined` if not found. */
export const getWidget = async (
  session: AgentsSession,
  idOrName: string
): Promise<Widget | undefined> => {
  const widgets = await listWidgets(session);
  return widgets.find((widget) => widget.id === idOrName || widget.name === idOrName);
};

export interface CreateWidgetInput {
  name: string;
  description?: string | null;
  spec: WidgetSpec;
}

/** Create a widget (`POST /api/widgets`). */
export const createWidget = async (
  session: AgentsSession,
  input: CreateWidgetInput
): Promise<Widget> =>
  agentsRequest<Widget>(session, "/api/widgets", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description ?? null,
      spec: input.spec,
    },
  });

export interface UpdateWidgetInput extends CreateWidgetInput {
  /** Id of the widget to replace. */
  id: string;
}

/** Update a widget (`PUT /api/widgets/{id}`, full-replacement). */
export const updateWidget = async (
  session: AgentsSession,
  input: UpdateWidgetInput
): Promise<void> => {
  await agentsRequest(session, `/api/widgets/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    body: {
      name: input.name,
      description: input.description ?? null,
      spec: input.spec,
    },
  });
};

/** Delete a widget (`DELETE /api/widgets/{id}`). */
export const deleteWidget = async (session: AgentsSession, id: string): Promise<void> => {
  await agentsRequest(session, `/api/widgets/${encodeURIComponent(id)}`, { method: "DELETE" });
};

/** A JSON-Patch op emitted by `generateWidgetSpec`. */
export interface WidgetSpecPatch {
  op: string;
  path: string;
  value?: unknown;
}

/**
 * AI-assisted widget-spec generation (`POST /api/generate-spec`). Streams
 * newline-delimited JSON-Patch ops that progressively build a `WidgetSpec`.
 */
export async function* generateWidgetSpec(
  session: AgentsSession,
  prompt: string,
  currentSpec?: WidgetSpec
): AsyncIterable<WidgetSpecPatch> {
  const chunks = agentsStream(session, "/api/generate-spec", {
    method: "POST",
    body: {
      prompt,
      context: { previousSpec: null },
      currentSpec: currentSpec ?? { root: "", elements: {} },
    },
  });
  let buffer = "";
  const emit = function* (line: string): Generator<WidgetSpecPatch> {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      yield JSON.parse(trimmed) as WidgetSpecPatch;
    } catch {
      /* skip an unparseable line */
    }
  };
  for await (const chunk of chunks) {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      yield* emit(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  yield* emit(buffer);
}
