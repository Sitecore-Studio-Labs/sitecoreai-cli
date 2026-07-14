/**
 * Recipe kinds for the Agentic Studio area — declarative definitions +
 * `sync` support for its authored resources.
 *
 * `agent` is create + update; `skill`, `widget`, `custom-mcp`, `schema`,
 * and `html-template` are create-only. `schema` and `html-template`
 * writes go through Next.js server actions (no `/api/` write endpoint) —
 * see their `api/` modules. `tools` have no write path and are not
 * recipe-managed.
 *
 * `agentRecipeKindByName` is the lookup the `agents-recipe` MCP tool and
 * the `scai agents sync` command dispatch through.
 */
import { eraseKind, registerKind, type RecipeKind } from "@/sync";
import { agentKind } from "./agent.kind";
import { skillKind } from "./skill.kind";
import { widgetKind } from "./widget.kind";
import { customMcpKind } from "./custom-mcp.kind";
import { schemaKind } from "./schema.kind";
import { htmlTemplateKind } from "./html-template.kind";

export { AgentRecipeSchema, type AgentRecipe } from "./agent.schema";
export { SkillRecipeSchema, type SkillRecipe } from "./skill.schema";
export { WidgetRecipeSchema, WidgetSpecSchema, type WidgetRecipe } from "./widget.schema";
export { CustomMcpRecipeSchema, type CustomMcpRecipe } from "./custom-mcp.schema";
export { SchemaRecipeSchema, type SchemaRecipe } from "./schema.schema";
export { HtmlTemplateRecipeSchema, type HtmlTemplateRecipe } from "./html-template.schema";
export { diffAgent } from "./agent.diff";
export { diffCreateOnly } from "./converge";
export { agentKind } from "./agent.kind";
export { skillKind } from "./skill.kind";
export { widgetKind } from "./widget.kind";
export { customMcpKind } from "./custom-mcp.kind";
export { schemaKind } from "./schema.kind";
export { htmlTemplateKind } from "./html-template.kind";
export { resolveAgentsSession } from "./client";

/** The Agentic Studio recipe kind names. */
export type AgentKindName =
  "agent" | "skill" | "widget" | "custom-mcp" | "schema" | "html-template";

/**
 * The Agentic Studio recipe kinds keyed by name. Values are erased to
 * `RecipeKind<unknown>` via `eraseKind` because `RecipeKind<T>` is
 * invariant in `T` and the map holds heterogeneous kinds.
 */
export const agentRecipeKindByName: Record<AgentKindName, RecipeKind<unknown>> = {
  agent: eraseKind(agentKind),
  skill: eraseKind(skillKind),
  widget: eraseKind(widgetKind),
  "custom-mcp": eraseKind(customMcpKind),
  schema: eraseKind(schemaKind),
  "html-template": eraseKind(htmlTemplateKind),
};

/**
 * Register every Agentic Studio recipe kind with the `sync` engine.
 * `registerKind` throws on a duplicate name, so call this exactly once
 * at startup.
 */
export const registerAgentRecipeKinds = (): void => {
  registerKind(agentKind);
  registerKind(skillKind);
  registerKind(widgetKind);
  registerKind(customMcpKind);
  registerKind(schemaKind);
  registerKind(htmlTemplateKind);
};
