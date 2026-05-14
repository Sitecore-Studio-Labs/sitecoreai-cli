import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config";
import { createWorkflowApiClient, type ItemSelector, type WorkflowApiClient } from "../api";

/** Shared option shape for `scai workflow *` tasks. */
export interface WorkflowTaskOptions {
  config?: string;
  environmentName?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  nonInteractive?: boolean;
}

export const toLogger = (options: WorkflowTaskOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

export interface ResolvedWorkflowTenant {
  envName: string;
  environment: EnvironmentConfiguration;
  root: RootConfiguration;
  client: WorkflowApiClient;
}

export const resolveWorkflowTenant = (options: WorkflowTaskOptions): ResolvedWorkflowTenant => {
  const { envName, environment, root, timeoutMs } = resolveEnvironment(options);
  const client = createWorkflowApiClient({
    environment,
    request: { timeoutMs },
  });
  return { envName, environment, root, client };
};

const ITEM_ID_PATTERN = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;

/**
 * Normalize a Sitecore item ID to dashed lowercase form
 * (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). The Authoring API's
 * `workflow.commands(query: {item: {itemId}})` and
 * `executeWorkflowCommand(input: {item: {itemId}})` both require this
 * dashed form even though `item(where: {itemId})` accepts undashed.
 *
 * Pass-through if the input isn't a 32-hex string — callers can rely on
 * receiving a still-valid input or surfacing the eventual API error.
 */
export const dashifyItemId = (id: string): string => {
  const hex = id.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Parse a `<itemId|path>` CLI argument into an `ItemSelector`. Accepts:
 *
 *   - 32-hex GUIDs with or without braces/hyphens → `{itemId}`
 *   - paths starting with `/sitecore/` → `{path}`
 *
 * Anything else throws an INPUT_INVALID error.
 */
export const parseItemReference = (value: string): ItemSelector => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw createScaiError("Item reference is empty.", "INPUT_INVALID");
  }
  if (trimmed.startsWith("/sitecore/") || trimmed.startsWith("/Sitecore/")) {
    return { path: trimmed };
  }
  if (ITEM_ID_PATTERN.test(trimmed)) {
    return { itemId: trimmed };
  }
  throw createScaiError(
    `'${value}' is not a valid item reference. Expected a Sitecore GUID or a content-tree path (starts with '/sitecore/').`,
    "INPUT_INVALID"
  );
};

/**
 * Render a result either as a `--json` envelope or as a small key/value
 * block for human-readable output. Used by `scai workflow inspect` /
 * `list-commands` where the result is a single record (not a long list
 * that would warrant the broader `printReport` helper from hygiene).
 */
export const printWorkflowResult = (params: {
  logger: Logger;
  command: string;
  envName: string;
  result: unknown;
  /** Lines of human-friendly text emitted when `--json` is off. */
  humanLines?: string[];
}): void => {
  const { logger, command, envName, result, humanLines } = params;
  if (logger.isJson()) {
    logger.json({ command, environment: envName, result });
    return;
  }
  if (humanLines && humanLines.length > 0) {
    for (const line of humanLines) logger.info(line);
  } else {
    logger.info(JSON.stringify(result, null, 2));
  }
};
