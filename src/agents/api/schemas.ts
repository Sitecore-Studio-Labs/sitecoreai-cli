/**
 * Structured-output schemas (`/api/schemas`).
 *
 * `listSchemas` reads. `createSchema` is **UNSTABLE**: there is no `/api/`
 * schema-write endpoint, so it replays the `/schemas/create` Next.js
 * server action via `agentsServerAction` — coupling scai to Agentic
 * Studio's internal build (the action hash rotates on every deploy). To
 * be deleted when a real `POST /api/schemas` endpoint ships.
 *
 * `updateSchema` re-runs the `/schemas/create` server action — verified
 * 2026-05-17 (agentic-studio-euw): that action upserts by name, so a
 * re-create *is* an update (REST `PUT /api/schemas/{id}` returns 405).
 * `deleteSchema` is still **UNVERIFIED** — `DELETE /api/schemas/{id}`
 * returns 405 and no delete server action has been captured. See
 * docs/agentic-studio-har-capture.md.
 */
import { agentsRequest, agentsServerAction, RSC_UNDEFINED } from "./request";
import { trimEdgeChar } from "../../shared/strings";
import type { AgentsSession } from "../session/types";
import type { StructuredSchema } from "./schema";

/** List every structured-output schema visible to the session. */
export const listSchemas = async (session: AgentsSession): Promise<StructuredSchema[]> => {
  const data = await agentsRequest<unknown>(session, "/api/schemas");
  return Array.isArray(data) ? (data as StructuredSchema[]) : [];
};

/** Find one schema by `id`, `schemaId`, or `name`. Returns `undefined` if not found. */
export const getSchema = async (
  session: AgentsSession,
  idOrName: string
): Promise<StructuredSchema | undefined> => {
  const schemas = await listSchemas(session);
  return schemas.find(
    (schema) => schema.id === idOrName || schema.schemaId === idOrName || schema.name === idOrName
  );
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
  trimEdgeChar(name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), "_") || "schema";

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

export interface UpdateSchemaInput extends CreateSchemaInput {
  /** Id of the schema to replace. */
  id: string;
}

/**
 * Update a structured-output schema. There is no REST update
 * (`PUT /api/schemas/{id}` → 405); instead the `/schemas/create` server
 * action upserts by name, so an update is a re-create — verified
 * 2026-05-17. `input.id` is unused: the server action keys on the name.
 */
export const updateSchema = async (
  session: AgentsSession,
  input: UpdateSchemaInput
): Promise<void> => {
  await createSchema(session, input);
};

/** Delete a schema (`DELETE /api/schemas/{id}`). **UNVERIFIED — returned 405; see header.** */
export const deleteSchema = async (session: AgentsSession, id: string): Promise<void> => {
  await agentsRequest(session, `/api/schemas/${encodeURIComponent(id)}`, { method: "DELETE" });
};
