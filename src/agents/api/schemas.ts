/**
 * Structured-output schemas (`/api/schemas`).
 *
 * `listSchemas` reads. `createSchema` is **UNSTABLE**: there is no `/api/`
 * schema-write endpoint, so it replays the `/schemas/create` Next.js
 * server action via `agentsServerAction` — coupling scai to Agentic
 * Studio's internal build (the action hash rotates on every deploy). To
 * be deleted when a real `POST /api/schemas` endpoint ships.
 */
import { agentsRequest, agentsServerAction, RSC_UNDEFINED } from "./request";
import type { AgentsSession } from "../session/types";
import type { StructuredSchema } from "./schema";

/** List every structured-output schema visible to the session. */
export const listSchemas = async (session: AgentsSession): Promise<StructuredSchema[]> => {
  const data = await agentsRequest<unknown>(session, "/api/schemas");
  return Array.isArray(data) ? (data as StructuredSchema[]) : [];
};

/**
 * Last-resort `/schemas/create` server-action hash. The hash ROTATES on
 * every Agentic Studio deploy; `scai agents login` discovers the current
 * one and stores it on the session (`session.actionHashes`), so this
 * constant is only reached when discovery failed AND
 * `SITECOREAI_SCHEMA_ACTION` is unset.
 */
const SCHEMA_CREATE_ACTION = "60087ab4468f98b69c7cd3b32c83a5d7b1ca883ff1";

/** Router-state-tree the `/schemas/create` action expects. */
const SCHEMA_CREATE_ROUTER_TREE =
  '["",{"children":["(settings)",{"children":["schemas",{"children":' +
  '["create",{"children":["__PAGE__",{},null,null,0]},null,null,0]},null,null,0]},null,null,0]},null,null,20]';

/** Derive a snake_case structured-output function name from a display name. */
const toFunctionName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "schema";

export interface CreateSchemaInput {
  /** Display name and identifier of the schema. */
  name: string;
  description?: string;
  /** The JSON-Schema object the structured output must satisfy. */
  schema: Record<string, unknown>;
  /** Enforce the schema strictly. Defaults to true. */
  strict?: boolean;
  tags?: string[];
}

/**
 * Create a structured-output schema. **UNSTABLE — see the file header.**
 *
 * Replays the `/schemas/create` server action. Throws `AGENTS_API_FAILED`
 * with a re-capture hint when the action hash has rotated (the most
 * likely failure after an Agentic Studio deploy).
 */
export const createSchema = async (
  session: AgentsSession,
  input: CreateSchemaInput
): Promise<void> => {
  await agentsServerAction(session, "/schemas/create", {
    actionHash:
      session.actionHashes?.["/schemas/create"] ??
      process.env.SITECOREAI_SCHEMA_ACTION ??
      SCHEMA_CREATE_ACTION,
    routerStateTree: SCHEMA_CREATE_ROUTER_TREE,
    // Server-action args: [prevState, payload] in Next.js RSC encoding —
    // `$undefined` stands in for absent optionals, matching a captured call.
    args: [
      null,
      {
        schemaId: input.name,
        name: input.name,
        description: input.description ?? RSC_UNDEFINED,
        fields: {
          name: toFunctionName(input.name),
          strict: input.strict ?? true,
          schema: input.schema,
        },
        tags: input.tags ?? RSC_UNDEFINED,
      },
    ],
  });
};
