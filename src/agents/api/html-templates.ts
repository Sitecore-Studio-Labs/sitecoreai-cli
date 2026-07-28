/**
 * HTML templates (`/api/html-templates`).
 *
 * `listHtmlTemplates` reads. `createHtmlTemplate` is **UNSTABLE**: there
 * is no `/api/` html-template-write endpoint, so it replays the
 * `/html-templates/create` Next.js server action via `agentsServerAction`
 * — coupling scai to Agentic Studio's internal build (the action hash
 * rotates on every deploy). To be deleted when a real
 * `POST /api/html-templates` endpoint ships.
 *
 * `updateHtmlTemplate` replays the `updateHtmlTemplateAction` server
 * action (`POST /html-templates/{id}`) — its hash, route, args, and
 * router tree were captured live 2026-05-17 (agentic-studio-euw) with
 * `scripts/record-agentic-actions.ts`.
 *
 * **Still UNVERIFIED:** `GET /api/html-templates` returns 404 on that
 * tenant — no list/read path has been observed — so `listHtmlTemplates` /
 * `getHtmlTemplate` fail and the CLI can only address a template by its
 * id; and `deleteHtmlTemplate` has no confirmed endpoint.
 */
import { agentsRequest, agentsServerAction, RSC_UNDEFINED } from "./request";
import type { AgentsSession } from "../session/types";
import type { HtmlTemplate } from "./schema";

/** List every HTML template visible to the session. */
export const listHtmlTemplates = async (session: AgentsSession): Promise<HtmlTemplate[]> => {
  const data = await agentsRequest<unknown>(session, "/api/html-templates");
  return Array.isArray(data) ? (data as HtmlTemplate[]) : [];
};

/** Find one HTML template by `id`, `templateId`, or `name`. `undefined` if not found. */
export const getHtmlTemplate = async (
  session: AgentsSession,
  idOrName: string
): Promise<HtmlTemplate | undefined> => {
  const templates = await listHtmlTemplates(session);
  return templates.find(
    (template) =>
      template.id === idOrName || template.templateId === idOrName || template.name === idOrName
  );
};

/**
 * Last-resort `/html-templates/create` server-action hash. The hash
 * ROTATES on every Agentic Studio deploy; `scai agents login` discovers
 * the current one and stores it on the session (`session.actionHashes`),
 * so this constant is only reached when discovery failed AND
 * `SITECOREAI_HTML_TEMPLATE_ACTION` is unset.
 */
const HTML_TEMPLATE_CREATE_ACTION = "60702b611beeb3886f6a3d118e6332d1f6a3a29610";

/** Router-state-tree the `/html-templates/create` action expects. */
const HTML_TEMPLATE_CREATE_ROUTER_TREE =
  '["",{"children":["(settings)",{"children":["html-templates",{"children":' +
  '["create",{"children":["__PAGE__",{},null,null,0]},null,null,0]},null,null,0]},null,null,0]},null,null,20]';

export interface CreateHtmlTemplateInput {
  /** Display name and identifier of the template. */
  name: string;
  /** The template's HTML body. */
  code: string;
  description?: string;
  tags?: string[];
}

/**
 * Create an HTML template. **UNSTABLE — see the file header.**
 *
 * Replays the `/html-templates/create` server action. Throws
 * `AGENTS_API_FAILED` with a re-capture hint when the action hash has
 * rotated (the most likely failure after an Agentic Studio deploy).
 */
export const createHtmlTemplate = async (
  session: AgentsSession,
  input: CreateHtmlTemplateInput
): Promise<void> => {
  await agentsServerAction(session, "/html-templates/create", {
    actionHash:
      session.actionHashes?.["/html-templates/create"] ??
      process.env.SITECOREAI_HTML_TEMPLATE_ACTION ??
      HTML_TEMPLATE_CREATE_ACTION,
    routerStateTree: HTML_TEMPLATE_CREATE_ROUTER_TREE,
    // Server-action args: [prevState, payload] — `$undefined` for absent optionals.
    args: [
      null,
      {
        templateId: input.name,
        name: input.name,
        code: input.code,
        description: input.description ?? RSC_UNDEFINED,
        tags: input.tags ?? RSC_UNDEFINED,
      },
    ],
  });
};

export interface UpdateHtmlTemplateInput extends CreateHtmlTemplateInput {
  /** Id of the HTML template to replace. */
  id: string;
}

/**
 * Last-resort `updateHtmlTemplateAction` server-action hash, captured
 * 2026-05-17. Rotates per Agentic Studio deploy — override with
 * `SITECOREAI_HTML_TEMPLATE_UPDATE_ACTION`.
 */
const HTML_TEMPLATE_UPDATE_ACTION = "6077abcec88bb09d86dd7229fce7031d84a96daa3c";

/** Router-state-tree for the `/html-templates/{id}` edit page. */
const htmlTemplateEditRouterTree = (id: string): string =>
  '["",{"children":["(settings)",{"children":["html-templates",{"children":' +
  `[["id",${JSON.stringify(id)},"d",null],` +
  '{"children":["__PAGE__",{},null,null,0]},null,null,0]},null,null,0]},null,null,0]},null,null,20]';

/**
 * Update an HTML template — replays the `updateHtmlTemplateAction` server
 * action `POST /html-templates/{id}`. The hash, route, router tree, and
 * argument tuple (`[id, {templateId, name, description, code, tags}]`)
 * were captured live 2026-05-17 — see the file header.
 */
export const updateHtmlTemplate = async (
  session: AgentsSession,
  input: UpdateHtmlTemplateInput
): Promise<void> => {
  await agentsServerAction(session, `/html-templates/${encodeURIComponent(input.id)}`, {
    actionHash: process.env.SITECOREAI_HTML_TEMPLATE_UPDATE_ACTION ?? HTML_TEMPLATE_UPDATE_ACTION,
    routerStateTree: htmlTemplateEditRouterTree(input.id),
    // Captured arg tuple: [id, payload] — `$undefined` for absent optionals.
    args: [
      input.id,
      {
        templateId: input.name,
        name: input.name,
        description: input.description ?? RSC_UNDEFINED,
        code: input.code,
        tags: input.tags ?? RSC_UNDEFINED,
      },
    ],
  });
};

/** Delete an HTML template (`DELETE /api/html-templates/{id}`). **UNVERIFIED — 404; see header.** */
export const deleteHtmlTemplate = async (session: AgentsSession, id: string): Promise<void> => {
  await agentsRequest(session, `/api/html-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
};
