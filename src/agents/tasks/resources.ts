/**
 * `scai agents {skill,widget,schema,mcp,html-template,tool} …` — the
 * non-agent Agentic Studio resources.
 *
 * These five resources share one shape — `list` / `get` / `create` are
 * API-backed; `update` / `delete` are **UNVERIFIED** (no such request has
 * been observed in a HAR) and gated behind `--unverified`. `makeResourceTasks`
 * builds the runner set once; each resource just supplies its API calls,
 * recipe schema, and rendering. `tool` is catalog-only — list, no writes.
 */
import type { ZodType } from "zod";
import { loadRecipe } from "@/sync";
import { createScaiError } from "@/shared/errors";
import type { AgentsSession } from "../session/types";
import {
  createCustomMcp,
  deleteCustomMcp,
  getCustomMcp,
  listCustomMcps,
  updateCustomMcp,
} from "../api/custom-mcps";
import {
  createHtmlTemplate,
  deleteHtmlTemplate,
  getHtmlTemplate,
  listHtmlTemplates,
  updateHtmlTemplate,
} from "../api/html-templates";
import { createSchema, deleteSchema, getSchema, listSchemas, updateSchema } from "../api/schemas";
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from "../api/skills";
import { createWidget, deleteWidget, getWidget, listWidgets, updateWidget } from "../api/widgets";
import { listTools } from "../api/tools";
import { CustomMcpRecipeSchema } from "../recipe/custom-mcp.schema";
import { HtmlTemplateRecipeSchema } from "../recipe/html-template.schema";
import { SchemaRecipeSchema } from "../recipe/schema.schema";
import { SkillRecipeSchema } from "../recipe/skill.schema";
import { WidgetRecipeSchema } from "../recipe/widget.schema";
import {
  prepare,
  renderItem,
  renderList,
  requireUnverified,
  writeAgentsEnvelope,
  type RunAgentsBaseOptions,
} from "./shared";

/** What a single resource supplies to `makeResourceTasks`. */
interface ResourceTaskConfig<
  TRecipe extends { name: string },
  TResource extends Record<string, unknown>,
> {
  /** Singular resource label and command name, e.g. "skill". */
  resource: string;
  /** Plural label for `renderList`, e.g. "skill(s)". */
  pluralLabel: string;
  /** Recipe schema validating `create` / `update` input files. */
  schema: ZodType<TRecipe>;
  list: (session: AgentsSession) => Promise<TResource[]>;
  find: (session: AgentsSession, idOrName: string) => Promise<TResource | undefined>;
  /** Extract the stable id + display name from a live resource. */
  identify: (item: TResource) => { id: string; name: string };
  /** Render one resource as a list line. */
  line: (item: TResource) => string;
  create: (session: AgentsSession, recipe: TRecipe) => Promise<unknown>;
  update: (session: AgentsSession, id: string, recipe: TRecipe) => Promise<void>;
  remove: (session: AgentsSession, id: string) => Promise<void>;
  /** `true` once the `PUT` endpoint is confirmed against a live tenant. */
  updateVerified: boolean;
  /** `true` once the `DELETE` endpoint is confirmed against a live tenant. */
  deleteVerified: boolean;
  /**
   * When `true`, `update` / `delete` treat the `<idOrName>` argument as
   * the id directly and skip the `find` lookup — for a resource whose
   * list endpoint is unavailable (html-template: `GET /api/html-templates`
   * → 404), so a name cannot be resolved to an id.
   */
  resolveById?: boolean;
}

/** The runner set every non-agent resource exposes. */
export interface ResourceTasks {
  /** Whether `update` hits a verified endpoint (drives the `--unverified` gate). */
  updateVerified: boolean;
  /** Whether `delete` hits a verified endpoint (drives the `--unverified` gate). */
  deleteVerified: boolean;
  runList: (options: RunAgentsBaseOptions) => Promise<void>;
  runGet: (options: RunAgentsBaseOptions & { idOrName: string }) => Promise<void>;
  runCreate: (options: RunAgentsBaseOptions & { file: string; whatIf?: boolean }) => Promise<void>;
  runUpdate: (
    options: RunAgentsBaseOptions & {
      idOrName: string;
      file: string;
      unverified?: boolean;
      whatIf?: boolean;
    }
  ) => Promise<void>;
  runDelete: (
    options: RunAgentsBaseOptions & {
      idOrName: string;
      unverified?: boolean;
      whatIf?: boolean;
    }
  ) => Promise<void>;
}

const makeResourceTasks = <
  TRecipe extends { name: string },
  TResource extends Record<string, unknown>,
>(
  config: ResourceTaskConfig<TRecipe, TResource>
): ResourceTasks => {
  const notFound = (idOrName: string): Error =>
    createScaiError(`No ${config.resource} matching "${idOrName}".`, "INPUT_INVALID", {
      hint: `List them with \`scai agents ${config.resource} list\`.`,
    });

  const runList: ResourceTasks["runList"] = async (options) => {
    const { logger, session } = await prepare(options);
    renderList({
      logger,
      command: `${config.resource}.list`,
      options,
      label: config.pluralLabel,
      items: await config.list(session),
      line: config.line,
    });
  };

  const runGet: ResourceTasks["runGet"] = async (options) => {
    const { logger, session } = await prepare(options);
    const item = await config.find(session, options.idOrName);
    if (!item) throw notFound(options.idOrName);
    renderItem(
      logger,
      `${config.resource}.get`,
      options,
      `${config.resource} "${config.identify(item).name}"`,
      item
    );
  };

  const runCreate: ResourceTasks["runCreate"] = async (options) => {
    const { logger, session } = await prepare(options);
    const recipe = await loadRecipe(options.file, config.schema);
    if (await config.find(session, recipe.name)) {
      throw createScaiError(
        `A ${config.resource} named "${recipe.name}" already exists.`,
        "INPUT_INVALID",
        { hint: `Pick a different name, or use \`scai agents ${config.resource} update\`.` }
      );
    }
    if (options.whatIf) {
      if (logger.isJson())
        writeAgentsEnvelope(
          `${config.resource}.create`,
          options,
          { plan: { create: recipe.name } },
          { whatIf: true }
        );
      else logger.info(`Would create ${config.resource} "${recipe.name}".`, "yellow");
      return;
    }
    const created = await config.create(session, recipe);
    if (logger.isJson())
      writeAgentsEnvelope(`${config.resource}.create`, options, { ok: true, created });
    else logger.info(`Created ${config.resource} "${recipe.name}".`, "green");
  };

  const runUpdate: ResourceTasks["runUpdate"] = async (options) => {
    if (!config.updateVerified) {
      requireUnverified(options.unverified, config.resource, "update");
    }
    const { logger, session } = await prepare(options);
    const recipe = await loadRecipe(options.file, config.schema);
    let id: string;
    if (config.resolveById) {
      id = options.idOrName;
    } else {
      const item = await config.find(session, options.idOrName);
      if (!item) throw notFound(options.idOrName);
      id = config.identify(item).id;
    }
    if (options.whatIf) {
      if (logger.isJson())
        writeAgentsEnvelope(
          `${config.resource}.update`,
          options,
          { plan: { update: id } },
          { whatIf: true }
        );
      else logger.info(`Would update ${config.resource} "${options.idOrName}" (${id}).`, "yellow");
      return;
    }
    await config.update(session, id, recipe);
    if (logger.isJson())
      writeAgentsEnvelope(`${config.resource}.update`, options, { ok: true, updated: id });
    else logger.info(`Updated ${config.resource} (${id}).`, "green");
  };

  const runDelete: ResourceTasks["runDelete"] = async (options) => {
    if (!config.deleteVerified) {
      requireUnverified(options.unverified, config.resource, "delete");
    }
    const { logger, session } = await prepare(options);
    let id: string;
    let name: string;
    if (config.resolveById) {
      id = options.idOrName;
      name = options.idOrName;
    } else {
      const item = await config.find(session, options.idOrName);
      if (!item) throw notFound(options.idOrName);
      ({ id, name } = config.identify(item));
    }
    if (options.whatIf) {
      if (logger.isJson())
        writeAgentsEnvelope(
          `${config.resource}.delete`,
          options,
          { plan: { delete: id } },
          { whatIf: true }
        );
      else logger.info(`Would delete ${config.resource} "${name}" (${id}).`, "yellow");
      return;
    }
    await config.remove(session, id);
    if (logger.isJson())
      writeAgentsEnvelope(`${config.resource}.delete`, options, { ok: true, deleted: id });
    else logger.info(`Deleted ${config.resource} "${name}".`, "green");
  };

  return {
    updateVerified: config.updateVerified,
    deleteVerified: config.deleteVerified,
    runList,
    runGet,
    runCreate,
    runUpdate,
    runDelete,
  };
};

/** `scai agents skill …` */
export const skillTasks = makeResourceTasks({
  resource: "skill",
  pluralLabel: "skill(s)",
  schema: SkillRecipeSchema,
  list: listSkills,
  find: getSkill,
  identify: (skill) => ({ id: skill.id, name: skill.name }),
  line: (skill) => `${skill.slug.padEnd(30)} ${skill.name}`,
  create: (session, recipe) => createSkill(session, recipe),
  update: (session, id, recipe) => updateSkill(session, { id, ...recipe }),
  remove: deleteSkill,
  // Verified 2026-05-17 against agentic-studio-euw — PUT/DELETE both work.
  updateVerified: true,
  deleteVerified: true,
});

/** `scai agents widget …` */
export const widgetTasks = makeResourceTasks({
  resource: "widget",
  pluralLabel: "widget(s)",
  schema: WidgetRecipeSchema,
  list: listWidgets,
  find: getWidget,
  identify: (widget) => ({ id: widget.id, name: widget.name }),
  line: (widget) => `${widget.id.padEnd(38)} ${widget.name}`,
  create: (session, recipe) => createWidget(session, recipe),
  update: (session, id, recipe) => updateWidget(session, { id, ...recipe }),
  remove: deleteWidget,
  // Verified 2026-05-17 against agentic-studio-euw — PUT/DELETE both work.
  updateVerified: true,
  deleteVerified: true,
});

/** `scai agents schema …` */
export const schemaTasks = makeResourceTasks({
  resource: "schema",
  pluralLabel: "schema(s)",
  schema: SchemaRecipeSchema,
  list: listSchemas,
  find: getSchema,
  identify: (schema) => ({
    id: String(schema.id ?? schema.schemaId ?? schema.name),
    name: schema.name,
  }),
  line: (schema) => `${String(schema.id ?? schema.schemaId ?? "?").padEnd(38)} ${schema.name}`,
  create: (session, recipe) => createSchema(session, recipe),
  update: (session, id, recipe) => updateSchema(session, { id, ...recipe }),
  remove: deleteSchema,
  // Verified 2026-05-17: `update` re-runs the create server action (an
  // upsert by name — works). `delete` has no endpoint — DELETE → 405.
  updateVerified: true,
  deleteVerified: false,
});

/** `scai agents mcp …` — registered custom MCP servers. */
export const mcpTasks = makeResourceTasks({
  resource: "mcp",
  pluralLabel: "custom MCP(s)",
  schema: CustomMcpRecipeSchema,
  list: listCustomMcps,
  find: getCustomMcp,
  identify: (mcp) => ({ id: mcp.id, name: mcp.name }),
  line: (mcp) => `${mcp.name.padEnd(24)} ${mcp.url}`,
  create: (session, recipe) => createCustomMcp(session, recipe),
  update: (session, id, recipe) => updateCustomMcp(session, { id, ...recipe }),
  remove: deleteCustomMcp,
  // Verified 2026-05-17: DELETE works; a custom MCP has no update at all
  // (PUT → 405; re-POST duplicates instead of upserting).
  updateVerified: false,
  deleteVerified: true,
});

/** `scai agents html-template …` */
export const htmlTemplateTasks = makeResourceTasks({
  resource: "html-template",
  pluralLabel: "HTML template(s)",
  schema: HtmlTemplateRecipeSchema,
  list: listHtmlTemplates,
  find: getHtmlTemplate,
  identify: (template) => ({
    id: template.id,
    name: template.name ?? template.templateId ?? template.id,
  }),
  line: (template) => `${template.id.padEnd(38)} ${template.name ?? template.templateId ?? ""}`,
  create: (session, recipe) => createHtmlTemplate(session, recipe),
  update: (session, id, recipe) => updateHtmlTemplate(session, { id, ...recipe }),
  remove: deleteHtmlTemplate,
  // 2026-05-17: `GET /api/html-templates` is 404 — no list/read path — so a
  // template can only be addressed by id (`resolveById`). `update` replays
  // the captured `updateHtmlTemplateAction` server action; it is wired from
  // a live recording but not yet run through the CLI, so stays gated.
  // `delete` has no captured endpoint.
  updateVerified: false,
  deleteVerified: false,
  resolveById: true,
});

/** `scai agents tool list` — the tool catalog is read-only (no write path). */
export const runToolList = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session } = await prepare(options);
  renderList({
    logger,
    command: "tool.list",
    options,
    label: "tool(s)",
    items: await listTools(session),
    line: (tool: { toolKey: string; category: string; label: string }) =>
      `${tool.toolKey.padEnd(30)} ${tool.category.padEnd(12)} ${tool.label}`,
  });
};
