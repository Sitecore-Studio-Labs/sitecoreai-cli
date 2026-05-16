/**
 * HTML templates (`/api/html-templates`).
 *
 * `listHtmlTemplates` reads. `createHtmlTemplate` is **UNSTABLE**: there
 * is no `/api/` html-template-write endpoint, so it replays the
 * `/html-templates/create` Next.js server action via `agentsServerAction`
 * — coupling scai to Agentic Studio's internal build (the action hash
 * rotates on every deploy). To be deleted when a real
 * `POST /api/html-templates` endpoint ships.
 */
import { agentsRequest, agentsServerAction, RSC_UNDEFINED } from "./request";
import type { AgentsSession } from "../session/types";
import type { HtmlTemplate } from "./schema";

/** List every HTML template visible to the session. */
export const listHtmlTemplates = async (session: AgentsSession): Promise<HtmlTemplate[]> => {
  const data = await agentsRequest<unknown>(session, "/api/html-templates");
  return Array.isArray(data) ? (data as HtmlTemplate[]) : [];
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
