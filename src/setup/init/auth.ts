import { openBrowser } from "@/shared/browser";
import { assertValidUrl } from "@/shared/validate";
import { createScaiError } from "@/shared/errors";
import { getDeployToken } from "@/shared/keychain";
import { resolveEnvClientSecret } from "@/shared/client-credential";
import { assertInteractive, promptConfirm, promptSecret, promptText } from "@/shared/prompt";
import { requestClientCredentialsToken, requestDeviceAuthorization, pollDeviceToken } from "@/auth";
import type { EnvironmentConfiguration } from "@/config/types";
import type { ConnectOptions } from "@/serialization/tasks/types";
import { DEFAULT_PUBLIC_CLIENT_ID } from "../constants";
import type { Logger } from "@/shared/logger";

type ResolveDeployAuthInput = {
  options: ConnectOptions;
  envName: string;
  existing: EnvironmentConfiguration;
  baseEnv: EnvironmentConfiguration;
  runWizard: boolean;
  isInteractive: boolean;
  needsDeployToken: boolean;
  logger: Logger;
};

type ResolveDeployAuthResult = {
  deployToken?: string;
  loginAuthority: string;
  loginClientId?: string;
  wantsClientCredentials: boolean;
  shouldPersistClientId: boolean;
  /**
   * Freshness metadata for a freshly minted deploy token. Present only
   * when this call performed a login; the caller writes it onto the env
   * profile in the config file (`deployTokenExpiresIn` /
   * `deployTokenLastUpdated`) — see docs/credentials.md.
   */
  deployTokenMeta?: { expiresIn: number | null; lastUpdated: string };
};

const DEPLOY_AUDIENCE = "https://api.sitecorecloud.io";

type MintedToken = {
  deployToken: string;
  deployTokenMeta: { expiresIn: number | null; lastUpdated: string };
};

/** Mint a deploy token via the client-credentials (machine) flow. */
const mintClientCredentialsToken = async (params: {
  loginAuthority?: string;
  loginClientId?: string;
  loginClientSecret?: string;
}): Promise<MintedToken> => {
  const { loginAuthority, loginClientId, loginClientSecret } = params;
  if (!loginAuthority || !loginClientId || !loginClientSecret) {
    throw createScaiError(
      "Client ID and client secret are required for client credentials.",
      "AUTH_REQUIRED",
      {
        hint: "Provide --client-id/--client-secret with --use-client-credentials, or set SITECOREAI_CLIENT_ID and SITECOREAI_CLIENT_SECRET.",
      }
    );
  }
  const token = await requestClientCredentialsToken(
    {
      authority: loginAuthority,
      clientId: loginClientId,
      clientSecret: loginClientSecret,
      audience: DEPLOY_AUDIENCE,
    },
    undefined
  );
  return {
    deployToken: token.accessToken,
    deployTokenMeta: { expiresIn: token.expiresIn ?? null, lastUpdated: new Date().toISOString() },
  };
};

/** Mint a deploy token via the interactive device-authorization (browser) flow. */
const mintDeviceToken = async (params: {
  loginAuthority?: string;
  loginClientId?: string;
  loginClientSecret?: string;
  isInteractive: boolean;
  logger: Logger;
}): Promise<MintedToken> => {
  const { loginAuthority, loginClientId, loginClientSecret, isInteractive, logger } = params;
  if (!loginAuthority || !loginClientId) {
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
    {
      authority: loginAuthority,
      clientId: loginClientId,
      clientSecret: loginClientSecret,
      audience: DEPLOY_AUDIENCE,
    },
    undefined
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
  const token = await pollDeviceToken(
    {
      authority: loginAuthority,
      clientId: loginClientId,
      clientSecret: loginClientSecret,
      audience: DEPLOY_AUDIENCE,
    },
    device
  );
  return {
    deployToken: token.accessToken,
    deployTokenMeta: { expiresIn: token.expiresIn ?? null, lastUpdated: new Date().toISOString() },
  };
};

/**
 * Resolve the login authority, validating it as a URL when present.
 * Order: base env profile → existing profile → env var → public default.
 */
const resolveLoginAuthority = (
  existing: EnvironmentConfiguration,
  baseEnv: EnvironmentConfiguration
): string => {
  const loginAuthority =
    baseEnv.authority ??
    existing.authority ??
    process.env.SITECOREAI_AUTHORITY ??
    "https://auth.sitecorecloud.io";
  if (loginAuthority) {
    assertValidUrl(loginAuthority, "Authority");
  }
  return loginAuthority;
};

/**
 * Pick the effective login client id for the chosen credential mode.
 * Device flow always uses the public/device id; client-credentials falls
 * back through the profile chain.
 */
const selectLoginClientId = (params: {
  wantsClientCredentials: boolean;
  deviceClientId: string;
  clientCredentialsClientId?: string;
}): string => {
  const { wantsClientCredentials, deviceClientId, clientCredentialsClientId } = params;
  if (!wantsClientCredentials) {
    return deviceClientId;
  }
  return clientCredentialsClientId ?? "";
};

/**
 * Prompt for any missing client-credentials inputs (client id + secret)
 * when a deploy token still needs minting. Throws INPUT_INVALID in a
 * non-interactive context. Returns the resolved id + secret.
 */
const promptForClientCredentials = async (params: {
  needsDeployToken: boolean;
  wantsClientCredentials: boolean;
  isInteractive: boolean;
  loginClientId: string;
  loginClientSecret?: string;
}): Promise<{ loginClientId: string; loginClientSecret?: string }> => {
  const { needsDeployToken, wantsClientCredentials, isInteractive } = params;
  let { loginClientId, loginClientSecret } = params;
  if (needsDeployToken && wantsClientCredentials && !loginClientId) {
    if (!isInteractive) {
      throw createScaiError("Client ID is required for client credentials.", "INPUT_INVALID", {
        hint: "Provide --client-id with --use-client-credentials, or set SITECOREAI_CLIENT_ID and SITECOREAI_CLIENT_SECRET.",
      });
    }
    loginClientId = await promptText("Client ID");
  }
  if (needsDeployToken && wantsClientCredentials && !loginClientSecret) {
    if (!isInteractive) {
      throw createScaiError(
        "Client ID and client secret are required for client credentials.",
        "INPUT_INVALID",
        {
          hint: "Provide --client-id/--client-secret with --use-client-credentials, or set SITECOREAI_CLIENT_ID and SITECOREAI_CLIENT_SECRET.",
        }
      );
    }
    loginClientSecret = await promptSecret("Client secret: ");
  }
  return { loginClientId, loginClientSecret };
};

export const resolveDeployAuth = async (
  input: ResolveDeployAuthInput
): Promise<ResolveDeployAuthResult> => {
  const {
    options,
    envName,
    existing,
    baseEnv,
    runWizard,
    isInteractive,
    needsDeployToken,
    logger,
  } = input;
  let deployToken = options.deployToken ?? existing.deployToken ?? (await getDeployToken(envName));
  const loginAuthority = resolveLoginAuthority(existing, baseEnv);
  // The secret never lives on the env profile: it comes from the
  // `--client-secret` flag or the `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`
  // env var (resolved by `resolveEnvClientSecret`), else an interactive
  // prompt below.
  let loginClientSecret = options.clientSecret ?? resolveEnvClientSecret(envName);
  let wantsClientCredentials = Boolean(
    options.useClientCredentials || baseEnv.useClientCredentials || existing.useClientCredentials
  );
  const deviceClientId =
    options.clientId ?? process.env.SITECOREAI_CLIENT_ID ?? DEFAULT_PUBLIC_CLIENT_ID;
  const clientCredentialsClientId =
    options.clientId ?? baseEnv.clientId ?? existing.clientId ?? process.env.SITECOREAI_CLIENT_ID;
  if (needsDeployToken && runWizard && options.useClientCredentials === undefined) {
    const useDeviceLogin = await promptConfirm("Log in with Deploy (browser)?", true);
    wantsClientCredentials = !useDeviceLogin;
  }
  let loginClientId = selectLoginClientId({
    wantsClientCredentials,
    deviceClientId,
    clientCredentialsClientId,
  });
  const shouldPersistClientId = wantsClientCredentials
    ? Boolean(loginClientId)
    : Boolean(options.clientId);
  ({ loginClientId, loginClientSecret } = await promptForClientCredentials({
    needsDeployToken,
    wantsClientCredentials,
    isInteractive,
    loginClientId,
    loginClientSecret,
  }));
  let deployTokenMeta: ResolveDeployAuthResult["deployTokenMeta"];

  if (needsDeployToken && !deployToken && wantsClientCredentials) {
    const minted = await mintClientCredentialsToken({
      loginAuthority,
      loginClientId,
      loginClientSecret,
    });
    deployToken = minted.deployToken;
    deployTokenMeta = minted.deployTokenMeta;
  } else if (needsDeployToken && !deployToken) {
    const minted = await mintDeviceToken({
      loginAuthority,
      loginClientId,
      loginClientSecret,
      isInteractive,
      logger,
    });
    deployToken = minted.deployToken;
    deployTokenMeta = minted.deployTokenMeta;
  }

  return {
    deployToken,
    loginAuthority,
    loginClientId,
    wantsClientCredentials,
    shouldPersistClientId,
    deployTokenMeta,
  };
};
