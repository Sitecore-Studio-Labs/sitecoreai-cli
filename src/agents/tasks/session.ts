/**
 * `scai agents login | logout | status` — Agentic Studio session
 * management. `login` drives a headed-browser Playwright capture;
 * `logout` clears the keychain entry; `status` probes `/api/token-refresh`.
 */
import { resolveEnvironment } from "@/policy/environment";
import { resolveRegionCode } from "@/shared/region";
import { requestClientCredentialsToken } from "@/auth";
import { loginAgents, logoutAgents } from "../session";
import { agentsRequest } from "../api/request";
import { prepare, toLogger, writeAgentsEnvelope, type RunAgentsBaseOptions } from "./shared";

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
    writeAgentsEnvelope("login", options, { ok: true, envName, ...result });
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
    writeAgentsEnvelope("logout", options, { ok: cleared, envName });
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
    writeAgentsEnvelope("status", options, {
      envName,
      endpoint: session.baseUrl,
      valid,
      expiresAt: refresh?.expiresAt,
    });
    return;
  }
  logger.info(`Agentic Studio — ${envName}`, "cyan");
  logger.info(`  Endpoint: ${session.baseUrl}`);
  logger.info(`  Session:  ${valid ? "valid" : "invalid"}`);
  if (refresh?.expiresAt) logger.info(`  Token expires: ${refresh.expiresAt}`);
};
