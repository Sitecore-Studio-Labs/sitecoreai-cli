import { readRootConfiguration, readRootConfigurationFile } from "@/config";
import { openBrowser } from "@/shared/browser";
import { createScaiError } from "@/shared/errors";
import { setPublishingToken } from "@/shared/keychain";
import { Logger } from "@/shared/logger";
import { assertInteractive } from "@/shared/prompt";
import {
  pollDeviceToken,
  requestDeviceAuthorization,
} from "@/serialization/sitecore-api";
import { DEFAULT_PUBLIC_CLIENT_ID } from "@/serialization/tasks/env/constants";

const PUBLISHING_SCOPES =
  "openid profile email offline_access xmcpub.jobs.a:r xmcpub.jobs.a:w xmcpub.queue:r";

/**
 * Auth0 resource-server audience for publishing operations.
 * Confirmed 2026-05-14 via cross-referenced Auth0 errors:
 *   - M2M client with aud=api.sitecorecloud.io + xmcpub.* scopes
 *     → "client has not been granted scopes" (the audience exists
 *     for the client but doesn't host those scopes)
 *   - M2M client with aud=api-webapp.sitecorecloud.io + xmcpub.*
 *     → "client not authorized to access resource server" (the
 *     audience IS where those scopes live; the client lacks a
 *     grant to it)
 *   - Pages token: aud=api-webapp, scope includes xmcpub.* → works
 *
 * `xmcpub.*` scopes live on the `api-webapp.sitecorecloud.io`
 * resource server. Operator must have an automation client with
 * a client-grant for that resource server, including the
 * publishing scopes. Override via SITECOREAI_PUBLISHING_AUDIENCE.
 */
const PUBLISHING_AUDIENCE = "https://api-webapp.sitecorecloud.io";

const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
};

export interface RunPublishingLoginOptions {
  config?: string;
  environmentName?: string;
  clientId?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

/**
 * Interactive device-code login that asks Auth0 for publishing scopes
 * specifically (`xmcpub.jobs.a:r/w`, `xmcpub.queue:r`). The resulting
 * access token is stored in a publishing-specific keychain key so it
 * doesn't collide with the deploy token (which carries
 * `xmclouddeploy.*` scopes only).
 *
 * Two failure modes this surfaces:
 *   - If the Auth0 client isn't configured to grant publishing scopes,
 *     `requestDeviceAuthorization` returns `invalid_scope` and we
 *     surface a hint pointing at the Auth0 client config.
 *   - If the consent succeeds but the resulting token doesn't actually
 *     carry the requested scopes (Auth0 silently trimming), we log a
 *     warning so the operator knows the next API call will 403.
 */
export const runPublishingLogin = async (
  options: RunPublishingLoginOptions
): Promise<void> => {
  const logger = new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

  const envName = options.environmentName;
  if (!envName) {
    throw createScaiError("Environment name is required.", "INPUT_INVALID", {
      hint: "Pass --environment-name (or -n) to scai publish login.",
    });
  }

  const configPath = options.config ?? process.cwd();
  // Validate the config exists and the env is configured before going
  // anywhere near a browser flow.
  readRootConfigurationFile(configPath);
  const root = readRootConfiguration(configPath, envName);
  const env = root.environments[envName];
  if (!env) {
    throw createScaiError(`Environment '${envName}' is not configured.`, "ENV_NOT_FOUND", {
      hint: "Run 'scai init' to add it, or check --environment-name.",
    });
  }

  const isInteractive =
    process.stdin.isTTY && process.stdout.isTTY && process.env.SITECOREAI_NON_INTERACTIVE !== "1";
  if (!isInteractive) {
    assertInteractive(
      "scai publish login requires an interactive terminal — it opens a browser for OAuth consent.",
      "Run it in a TTY without --non-interactive."
    );
  }

  const authority =
    env.authority ?? process.env.SITECOREAI_AUTHORITY ?? "https://auth.sitecorecloud.io";
  const clientId =
    options.clientId ?? process.env.SITECOREAI_CLIENT_ID ?? DEFAULT_PUBLIC_CLIENT_ID;
  // Publishing scopes belong to the SAI api-webapp resource server,
  // not the standard xmcloud.cm/xmclouddeploy api.sitecorecloud.io
  // audience. Override via SITECOREAI_PUBLISHING_AUDIENCE if Sitecore
  // changes the resource server identifier.
  const audience =
    process.env.SITECOREAI_PUBLISHING_AUDIENCE ?? PUBLISHING_AUDIENCE;

  logger.info(
    `Requesting publishing scopes (xmcpub.jobs.a:r, xmcpub.jobs.a:w, xmcpub.queue:r) from Auth0.`,
    "cyan"
  );
  logger.info(`Audience: ${audience}`, "gray");
  logger.info(`Client:   ${clientId}`, "gray");

  let device;
  try {
    device = await requestDeviceAuthorization(
      { authority, clientId, audience },
      PUBLISHING_SCOPES
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.toLowerCase().includes("invalid_scope") || detail.toLowerCase().includes("scope")) {
      throw createScaiError(
        `Auth0 rejected the publishing scopes for client '${clientId}'.`,
        "AUTH_REQUIRED",
        {
          hint: "The default scai login client is not authorized to grant publishing scopes. Either register a new Auth0 client with xmcpub.* scopes and pass --client-id, or use the Sitecore Pages client (interactive login from XM Cloud).",
        }
      );
    }
    throw error;
  }

  const verifyUrl = device.verificationUriComplete ?? device.verificationUri;
  if (device.message) {
    logger.info(device.message);
  }
  if (!openBrowser(verifyUrl)) {
    logger.info(`Complete login at: ${verifyUrl}`);
  } else {
    logger.info(`Opened browser for: ${verifyUrl}`);
  }
  if (!device.verificationUriComplete && device.userCode) {
    logger.info(`Enter code: ${device.userCode}`);
  }

  const token = await pollDeviceToken({ authority, clientId, audience }, device);

  // Decode the resulting token and verify it actually carries the
  // requested scopes — Auth0 sometimes silently trims scopes the client
  // isn't authorized for, returning a "successful" token that the
  // Publishing API will then 403 on.
  const payload = decodeJwtPayload(token.accessToken);
  const tokenScope =
    typeof payload?.scope === "string"
      ? payload.scope
      : Array.isArray(payload?.scp)
        ? (payload.scp as unknown[]).join(" ")
        : "";
  const grantedScopes = tokenScope.split(/\s+/).filter(Boolean);
  const requested = ["xmcpub.jobs.a:r", "xmcpub.jobs.a:w", "xmcpub.queue:r"];
  const missing = requested.filter((s) => !grantedScopes.includes(s));

  await setPublishingToken(envName, token.accessToken);

  if (missing.length > 0) {
    logger.warn(
      `Token granted but missing scopes: ${missing.join(", ")}. The Publishing API will return 403 for those operations.`,
      "yellow"
    );
  } else {
    logger.info(
      `Publishing token stored. Granted scopes: ${requested.join(", ")}.`,
      "green"
    );
  }
};
