import { Logger } from "@/shared/logger";
import { resolveEnvironment } from "@/policy/environment";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";
import { createWebhookApiClient, type WebhookApiClient } from "../api/client";

/** Shared option shape for `scai content workflow webhook *` tasks. */
export interface WebhookTaskOptions {
  config?: string;
  environmentName?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  nonInteractive?: boolean;
}

export const toLogger = (options: WebhookTaskOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

export interface ResolvedWebhookTenant {
  envName: string;
  environment: EnvironmentConfiguration;
  root: RootConfiguration;
  client: WebhookApiClient;
}

export const resolveWebhookTenant = (options: WebhookTaskOptions): ResolvedWebhookTenant => {
  const { envName, environment, root, timeoutMs } = resolveEnvironment(options);
  const client = createWebhookApiClient({
    environment,
    request: { timeoutMs },
  });
  return { envName, environment, root, client };
};

/**
 * Render a result as a `--json` envelope or as a small human-readable
 * block. Mirrors `printWorkflowResult` — single-record commands don't
 * need hygiene's broader `printReport` with baseline + output-file
 * support.
 */
export const printWebhookResult = (params: {
  logger: Logger;
  command: string;
  envName: string;
  result: unknown;
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
