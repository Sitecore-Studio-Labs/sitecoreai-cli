import {
  readRootConfiguration,
  readRootConfigurationFile,
  writeRootConfigurationFile,
} from "@/config/root-config";
import { openBrowser } from "@/shared/browser";
import { assertValidUrl } from "@/shared/validate";
import { createScaiError, toScaiError } from "@/shared/errors";
import { enrollEnvironment } from "@/policy";
import { setCmTokens, setDeployToken } from "@/shared/keychain";
import { resolveEnvClientSecret } from "@/shared/client-credential";
import { assertInteractive, promptConfirm, promptSecret, promptText } from "@/shared/prompt";
import {
  requestClientCredentialsToken,
  requestDeviceAuthorization,
  pollDeviceToken,
} from "@/serialization/api/auth";
import { inputError, toLogger } from "@/shared/cli-tasks";
import type { DeployTokenOptions } from "@/deploy/tasks/types";
import type { EnvironmentConfiguration } from "@/config/types";
import {
  DEFAULT_PUBLIC_CLIENT_ID,
  SCAI_CLIENT_CREDENTIALS_SCOPES,
  SCAI_DEVICE_FLOW_SCOPES,
} from "./constants";

/**
 * Read an env var, treating an empty / whitespace-only value as unset.
 * `process.env.X` is `""` for an exported-but-blank var (common in CI and
 * sourced `.env` files); a plain `?? fallback` would keep that `""` and
 * shadow the default, so normalize to `undefined` first.
 */
const envValue = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

type DeployTokenResult = { accessToken: string; refreshToken?: string; expiresIn?: number };

type AcquireDeployTokenInput = {
  wantsClientCredentials: boolean;
  authority: string;
  clientId?: string;
  clientSecret?: string;
  audience: string;
  isInteractive: boolean;
  logger: ReturnType<typeof toLogger>;
};

/** Mint a token via client-credentials (machine) flow. */
const acquireClientCredentialsToken = async (
  input: AcquireDeployTokenInput
): Promise<DeployTokenResult> => {
  const { authority, clientId, clientSecret, audience } = input;
  if (!authority || !clientId || !clientSecret) {
    throw createScaiError(
      "Client ID and client secret are required for client credentials.",
      "AUTH_REQUIRED",
      {
        hint: "Provide --client-id/--client-secret with --use-client-credentials, or set SITECOREAI_CLIENT_ID and SITECOREAI_CLIENT_SECRET.",
      }
    );
  }
  return requestClientCredentialsToken(
    { authority, clientId, clientSecret, audience },
    SCAI_CLIENT_CREDENTIALS_SCOPES
  );
};

/** Mint a token via the interactive device-authorization (browser) flow. */
const acquireDeviceToken = async (input: AcquireDeployTokenInput): Promise<DeployTokenResult> => {
  const { authority, clientId, clientSecret, audience, isInteractive, logger } = input;
  if (!authority || !clientId) {
    throw createScaiError("Client ID is required for interactive login.", "AUTH_REQUIRED", {
      hint: "Provide --client-id or set SITECOREAI_CLIENT_ID.",
    });
  }
  if (!isInteractive) {
    assertInteractive(
      "Interactive login requires a TTY. Use --use-client-credentials instead.",
      "Use --use-client-credentials for non-interactive authentication."
    );
  }
  const device = await requestDeviceAuthorization(
    { authority, clientId, clientSecret, audience },
    SCAI_DEVICE_FLOW_SCOPES
  );
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
  return pollDeviceToken({ authority, clientId, clientSecret, audience }, device);
};

const acquireDeployToken = (input: AcquireDeployTokenInput): Promise<DeployTokenResult> =>
  input.wantsClientCredentials ? acquireClientCredentialsToken(input) : acquireDeviceToken(input);

/**
 * Decide whether the run uses the client-credentials (machine) flow or
 * the interactive device flow. The wizard-style confirm runs only when
 * neither flag nor profile expresses a preference and a TTY is present.
 */
const resolveWantsClientCredentials = async (
  options: DeployTokenOptions,
  baseEnv: { useClientCredentials?: boolean },
  isInteractive: boolean
): Promise<boolean> => {
  let wantsClientCredentials = Boolean(
    options.useClientCredentials || baseEnv.useClientCredentials
  );
  if (
    options.useClientCredentials === undefined &&
    baseEnv.useClientCredentials === undefined &&
    isInteractive
  ) {
    const useDeviceLogin = await promptConfirm("Log in with Deploy (browser)?", true);
    wantsClientCredentials = !useDeviceLogin;
  }
  return wantsClientCredentials;
};

/**
 * Resolve the client id + secret for the client-credentials flow,
 * prompting interactively for any missing piece. Throws INPUT_INVALID
 * when a required value is missing in a non-interactive context.
 */
const resolveClientCredentials = async (params: {
  clientId: string | undefined;
  clientSecret: string | undefined;
  isInteractive: boolean;
}): Promise<{ clientId: string | undefined; clientSecret: string | undefined }> => {
  let { clientId, clientSecret } = params;
  const { isInteractive } = params;
  if (!clientId && isInteractive) {
    clientId = await promptText("Client ID");
  }
  if (!clientSecret) {
    if (!isInteractive) {
      throw createScaiError(
        "Client ID and client secret are required for client credentials.",
        "INPUT_INVALID",
        {
          hint: "Provide --client-id/--client-secret with --use-client-credentials, or set SITECOREAI_CLIENT_ID and SITECOREAI_CLIENT_SECRET.",
        }
      );
    }
    clientSecret = await promptSecret("Client secret: ");
  }
  return { clientId, clientSecret };
};

/**
 * Mirror the minted token into both keychain slots (Deploy + CM) and warn
 * on partial failures. Returns whether the Deploy slot persisted.
 */
const persistTokenToKeychain = async (
  envName: string,
  token: DeployTokenResult,
  logger: ReturnType<typeof toLogger>
): Promise<boolean> => {
  const stored = await setDeployToken(envName, token.accessToken);
  if (!stored) {
    logger.warn(
      "Unable to store the Deploy token in the OS keychain. Use SITECOREAI_DEPLOY_TOKEN if needed.",
      "yellow"
    );
  }
  // Mirror the same token into the CM keychain slot. The token's scope
  // claim covers both Deploy AND `xmcloud.cm:admin`-gated paths (per the
  // explicit scope set we requested above), so one mint serves both
  // surfaces. Without this mirror, `getAccessToken` (Authoring API
  // reader) reads an empty CM slot and surfaces AUTH_REQUIRED even
  // though the equivalent token sits one slot over.
  const cmStored = await setCmTokens(envName, {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresIn: token.expiresIn,
    lastUpdated: new Date().toISOString(),
  });
  if (!cmStored && stored) {
    // Deploy slot wrote, CM didn't — unusual; warn but proceed since
    // Deploy commands still work without the mirror.
    logger.warn(
      "Stored the Deploy token but couldn't mirror it into the CM keychain slot. Authoring API calls (recipe/workflow/webhook) may fail until the next login retries.",
      "yellow"
    );
  }
  return stored;
};

/** Enroll the environment into the workspace policy, warning (never failing) on error. */
const enrollIntoPolicy = (
  envName: string,
  updated: EnvironmentConfiguration,
  logger: ReturnType<typeof toLogger>
): void => {
  // `scai setup login` is the operator interactively choosing this
  // environment, so it is auto-allowed and its tenant identity is pinned
  // for tamper detection. See docs/policy-and-guardrails.md.
  try {
    const enrollment = enrollEnvironment({ envName, environment: updated, via: "setup-login" });
    if (enrollment.created) {
      logger.info(
        "Workspace policy created — environment guardrails are now active. Manage with 'scai policy'.",
        "cyan"
      );
    }
  } catch (error) {
    logger.warn(`Could not update the workspace policy: ${toScaiError(error).message}`, "yellow");
  }
};

/** Print the raw token to stdout when `--print` is set, refusing under MCP. */
const printTokenIfRequested = (options: DeployTokenOptions, token: DeployTokenResult): void => {
  if (!options.print) {
    return;
  }
  // CLI-only token piping. Refuses to run under the MCP transport —
  // a raw bearer print would corrupt JSON-RPC framing on stdout and
  // leak a credential into the agent transcript. `runDeployToken`
  // isn't wired to any MCP tool today; this is defense in depth so
  // a future wiring mistake fails loudly.
  if (process.env.SITECOREAI_MCP_SERVE === "1") {
    throw createScaiError(
      "Refusing to print an access token while running under the MCP transport.",
      "AUTH_DENIED",
      { hint: "Run `scai setup login --print` from a terminal, not via the MCP server." }
    );
  }
  process.stdout.write(`${token.accessToken}\n`);
};

export const runDeployToken = async (options: DeployTokenOptions): Promise<void> => {
  const logger = toLogger(options);
  const envName = options.environmentName;
  if (!envName) {
    throw inputError("Environment name is required. Use --environment-name.");
  }

  const configPath = options.config ?? process.cwd();
  const rootConfigFile = readRootConfigurationFile(configPath);
  const root = readRootConfiguration(configPath, envName);
  const envProfiles = rootConfigFile.config.envProfiles ?? {};
  const existing = envProfiles[envName] ?? {};
  const baseEnv = root.environments[envName] ?? {};

  const isInteractive =
    process.stdin.isTTY && process.stdout.isTTY && process.env.SITECOREAI_NON_INTERACTIVE !== "1";
  const baseAuthority =
    baseEnv.authority ?? envValue("SITECOREAI_AUTHORITY") ?? "https://auth.sitecorecloud.io";
  if (baseAuthority) {
    assertValidUrl(baseAuthority, "Authority");
  }
  const deviceDefaultClientId =
    options.clientId ?? envValue("SITECOREAI_CLIENT_ID") ?? DEFAULT_PUBLIC_CLIENT_ID;
  const clientCredentialsDefaultClientId =
    options.clientId ?? baseEnv.clientId ?? envValue("SITECOREAI_CLIENT_ID");
  const wantsClientCredentials = await resolveWantsClientCredentials(
    options,
    baseEnv,
    isInteractive
  );

  const authority = baseAuthority;

  let clientId = wantsClientCredentials ? clientCredentialsDefaultClientId : deviceDefaultClientId;
  // The secret never lives on the env profile: it comes from the
  // `--client-secret` flag or the `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`
  // env var (resolved by `resolveEnvClientSecret`), else an interactive
  // prompt below.
  let clientSecret = options.clientSecret ?? resolveEnvClientSecret(envName);
  if (wantsClientCredentials) {
    ({ clientId, clientSecret } = await resolveClientCredentials({
      clientId,
      clientSecret,
      isInteractive,
    }));
  }
  const audience = baseEnv.audience ?? "https://api.sitecorecloud.io";

  const token = await acquireDeployToken({
    wantsClientCredentials,
    authority,
    clientId,
    clientSecret,
    audience,
    isInteractive,
    logger,
  });

  await persistTokenToKeychain(envName, token, logger);

  // Deploy-token freshness metadata lives on the env profile in the
  // config file — the config holds every token's non-secret metadata
  // (see docs/credentials.md). `deployToken` is cleared as legacy
  // token-cache metadata; a stale `clientSecret` field from an older
  // config is scrubbed via the cast.
  const updated: EnvironmentConfiguration = {
    ...existing,
    deployToken: undefined,
    deployTokenExpiresIn: token.expiresIn ?? null,
    deployTokenLastUpdated: new Date().toISOString(),
    ...({ clientSecret: undefined } as Record<string, undefined>),
  };
  if (wantsClientCredentials) {
    updated.clientId = clientId;
  }
  envProfiles[envName] = updated;
  rootConfigFile.config.envProfiles = envProfiles;
  writeRootConfigurationFile(configPath, rootConfigFile.config);

  enrollIntoPolicy(envName, updated, logger);

  logger.info(
    `SitecoreAI access token saved to the OS keychain for environment '${envName}' (Deploy + CM/admin scopes).`,
    "green"
  );
  printTokenIfRequested(options, token);
};
