/**
 * CLI runners for the `scai agents …` command family.
 *
 * Each runner resolves the environment, loads the keychain-backed
 * Agentic Studio session, calls a library helper, then prints human or
 * JSON output. Resource *creation* is intentionally absent — it is
 * served by the recipe kinds (`scai sync`), which converge declaratively.
 * The CLI covers session management, reads, runs, and deletes.
 */
import { readFileSync } from "node:fs";
import { resolveEnvironment } from "@/shared/env";
import { resolveRegionCode } from "@/shared/region";
import { requestClientCredentialsToken } from "@/serialization/api/auth";
import { Logger } from "@/shared/logger";
import { acquireAgentsSession, loginAgents, logoutAgents } from "../session";
import type { AgentsSession } from "../session/types";
import { agentsRequest } from "../api/request";
import { deleteAgent, getAgent, listAgents } from "../api/agents";
import { listSkills } from "../api/skills";
import { listTools } from "../api/tools";
import { listWidgets } from "../api/widgets";
import { listSchemas } from "../api/schemas";
import { listCustomMcps } from "../api/custom-mcps";
import { runAgent } from "../api/runs";
import { createScaiError } from "@/shared/errors";

export interface RunAgentsBaseOptions {
  config?: string;
  environmentName?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

const toLogger = (options: RunAgentsBaseOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

/** Resolve the env and load its Agentic Studio session. */
const prepare = async (
  options: RunAgentsBaseOptions
): Promise<{ logger: Logger; session: AgentsSession; envName: string }> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const session = await acquireAgentsSession(envName);
  return { logger, session, envName };
};

/** Shared list rendering — JSON passthrough or one line per item. */
const renderList = <T>(
  logger: Logger,
  label: string,
  items: T[],
  line: (item: T) => string
): void => {
  if (logger.isJson()) {
    writeJson(items);
    return;
  }
  if (items.length === 0) {
    logger.info(`No ${label} found.`, "yellow");
    return;
  }
  logger.info(`${items.length} ${label}:`, "cyan");
  for (const item of items) {
    logger.info(`  ${line(item)}`);
  }
};

// ---- session management ---------------------------------------------------

export const runAgentsLogin = async (
  options: RunAgentsBaseOptions & { region?: string }
): Promise<void> => {
  const logger = toLogger(options);
  const { envName, environment } = resolveEnvironment(options);
  // Region selects which `agentic-studio-<region>` BFF the browser
  // login targets. An explicit `--region` wins; otherwise it is
  // resolved from the org id via the shared resolver — best-effort, so
  // a credential-less env falls back to EU-West.
  const region =
    options.region ??
    (await resolveRegionCode({
      organizationId: environment.organizationId,
      acquireToken: async () => (await requestClientCredentialsToken(environment)).accessToken,
    }));
  logger.info("Opening a browser — sign in to Sitecore in the window…", "cyan");
  const result = await loginAgents({ envName, region });
  if (logger.isJson()) {
    writeJson({ ok: true, envName, ...result });
    return;
  }
  logger.info(
    `Agentic Studio session captured for "${envName}" (region ${result.region}).`,
    "green"
  );
};

export const runAgentsLogout = async (options: RunAgentsBaseOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const cleared = await logoutAgents(envName);
  if (logger.isJson()) {
    writeJson({ ok: cleared, envName });
    return;
  }
  logger.info(
    cleared
      ? `Cleared the Agentic Studio session for "${envName}".`
      : `No Agentic Studio session was stored for "${envName}".`,
    cleared ? "green" : "yellow"
  );
};

export const runAgentsStatus = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session, envName } = await prepare(options);
  const refresh = await agentsRequest<{ success?: boolean; expiresAt?: string }>(
    session,
    "/api/token-refresh"
  );
  const valid = refresh?.success !== false;
  if (logger.isJson()) {
    writeJson({ envName, endpoint: session.baseUrl, valid, expiresAt: refresh?.expiresAt });
    return;
  }
  logger.info(`Agentic Studio — ${envName}`, "cyan");
  logger.info(`  Endpoint: ${session.baseUrl}`);
  logger.info(`  Session:  ${valid ? "valid" : "invalid"}`);
  if (refresh?.expiresAt) logger.info(`  Token expires: ${refresh.expiresAt}`);
};

// ---- reads ----------------------------------------------------------------

export const runAgentList = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session } = await prepare(options);
  renderList(
    logger,
    "agent(s)",
    await listAgents(session),
    (agent) => `${agent.slug.padEnd(30)} ${agent.name ?? ""}`
  );
};

export const runSkillList = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session } = await prepare(options);
  renderList(
    logger,
    "skill(s)",
    await listSkills(session),
    (skill) => `${skill.slug.padEnd(30)} ${skill.name}`
  );
};

export const runToolList = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session } = await prepare(options);
  renderList(
    logger,
    "tool(s)",
    await listTools(session),
    (tool) => `${tool.toolKey.padEnd(30)} ${tool.category.padEnd(12)} ${tool.label}`
  );
};

export const runWidgetList = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session } = await prepare(options);
  renderList(
    logger,
    "widget(s)",
    await listWidgets(session),
    (widget) => `${widget.id.padEnd(38)} ${widget.name}`
  );
};

export const runSchemaList = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session } = await prepare(options);
  renderList(
    logger,
    "schema(s)",
    await listSchemas(session),
    (schema) => `${String(schema.id ?? schema.schemaId ?? "?").padEnd(38)} ${schema.name}`
  );
};

export const runCustomMcpList = async (options: RunAgentsBaseOptions): Promise<void> => {
  const { logger, session } = await prepare(options);
  renderList(
    logger,
    "custom MCP(s)",
    await listCustomMcps(session),
    (mcp) => `${mcp.name.padEnd(24)} ${mcp.url}`
  );
};

// ---- run ------------------------------------------------------------------

export const runAgentRun = async (
  options: RunAgentsBaseOptions & { agentSlug: string; message: string }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const { spaceId, events } = await runAgent(session, {
    agentSlug: options.agentSlug,
    message: options.message,
  });

  if (logger.isJson()) {
    const collected = [];
    for await (const event of events) collected.push(event);
    writeJson({ spaceId, events: collected });
    return;
  }

  logger.info(`Running "${options.agentSlug}" (space ${spaceId})…`, "cyan");
  for await (const event of events) {
    if (event.type === "text-delta" && typeof event.delta === "string") {
      process.stdout.write(event.delta);
    } else if (event.type === "data-artifactDelta") {
      const data = event.data as { content?: string } | undefined;
      if (typeof data?.content === "string") process.stdout.write(data.content);
    }
  }
  process.stdout.write("\n");
};

// ---- delete ---------------------------------------------------------------

export const runAgentDelete = async (
  options: RunAgentsBaseOptions & { idOrSlug: string; whatIf?: boolean }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const agent = await getAgent(session, options.idOrSlug);
  if (!agent) {
    throw createScaiError(`Agent "${options.idOrSlug}" not found.`, "INPUT_INVALID");
  }
  if (options.whatIf) {
    if (logger.isJson()) writeJson({ plan: { delete: agent.id } });
    else logger.info(`Would delete agent "${agent.slug}" (${agent.id}).`, "yellow");
    return;
  }
  await deleteAgent(session, agent.id);
  if (logger.isJson()) writeJson({ ok: true, deleted: agent.id });
  else logger.info(`Deleted agent "${agent.slug}".`, "green");
};

/** Read + validate a JSON file (used by recipe-style CLI inputs). */
export const readJsonFile = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8")) as unknown;
