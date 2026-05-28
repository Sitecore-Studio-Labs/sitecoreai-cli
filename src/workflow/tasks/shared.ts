import { Logger } from "@/shared/logger";
import { buildScaiEnvelope } from "@/shared/envelope";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";
import {
  createWorkflowApiClient,
  type ItemSelector,
  type WorkflowApiClient,
  type WorkflowDefinitionDetail,
} from "../api/client";

/** Shared option shape for `scai content workflow *` tasks. */
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

export const WORKFLOW_ITEM_ID_PATTERN =
  /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;
const ITEM_ID_PATTERN = WORKFLOW_ITEM_ID_PATTERN;

/**
 * Resolve a workflow ref (GUID, content-tree path, or display/item name)
 * to a `WorkflowDefinitionDetail` via the same lookup `scai content workflow
 * inspect` / `scai content workflow apply` use. Returns `null` when no
 * workflow-templated item matches the ref. Callers convert null into a
 * task-specific "skipped-workflow-not-found" outcome.
 */
export const resolveWorkflowRef = async (
  client: WorkflowApiClient,
  ref: string
): Promise<WorkflowDefinitionDetail | null> => {
  const wfRef = ref.trim();
  if (!wfRef) return null;
  if (wfRef.startsWith("/sitecore/") || wfRef.startsWith("/Sitecore/")) {
    return client.getWorkflowDefinitionDetail({ path: wfRef });
  }
  if (ITEM_ID_PATTERN.test(wfRef)) {
    return client.getWorkflowDefinitionDetail({ itemId: wfRef });
  }
  const found = await client.findWorkflowDefinitionByName(wfRef);
  if (!found) return null;
  return client.getWorkflowDefinitionDetail({ itemId: found.summary.itemId });
};

/**
 * Resolve a state ref (GUID, item name, or display name) against the
 * states declared on a workflow definition. Returns `null` when the ref
 * doesn't match any state — callers turn this into a
 * `skipped-state-not-found` outcome.
 */
export const resolveWorkflowState = (
  workflow: WorkflowDefinitionDetail,
  stateRef: string
): { itemId: string; name: string } | null => {
  const trimmed = stateRef.trim();
  if (!trimmed) return null;
  const isGuid = ITEM_ID_PATTERN.test(trimmed);
  const normalized = trimmed.replace(/[{}]/g, "").toLowerCase();
  const match = workflow.states.find((s) =>
    isGuid
      ? s.itemId.replace(/[{}]/g, "").toLowerCase() === normalized
      : s.name.toLowerCase() === trimmed.toLowerCase() ||
        s.displayName?.toLowerCase() === trimmed.toLowerCase()
  );
  if (!match) return null;
  return { itemId: match.itemId, name: match.displayName ?? match.name };
};

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
 * block for human-readable output. Used by `scai content workflow get` /
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
    logger.json(
      buildScaiEnvelope({
        command,
        environment: envName,
        data: result,
      }) as unknown as Record<string, unknown>
    );
    return;
  }
  if (humanLines && humanLines.length > 0) {
    for (const line of humanLines) logger.info(line);
  } else {
    logger.info(JSON.stringify(result, null, 2));
  }
};
