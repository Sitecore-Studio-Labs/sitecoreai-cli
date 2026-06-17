import { openBrowser } from "@/shared/browser";
import { assertValidUrl } from "@/shared/validate";
import { createScaiError } from "@/shared/errors";
import { getDeployToken } from "@/shared/keychain";
import { resolveEnvClientSecret } from "@/shared/client-credential";
import { assertInteractive, promptConfirm, promptSecret, promptText } from "@/shared/prompt";
import {
  requestClientCredentialsToken,
  requestDeviceAuthorization,
  pollDeviceToken,
} from "@/serialization/api/auth";
import type { EnvironmentConfiguration } from "@/config/types";
import type { ConnectOptions } from "../../types";
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
  let loginAuthority =
    baseEnv.authority ??
    existing.authority ??
    process.env.SITECOREAI_AUTHORITY ??
    "https://auth.sitecorecloud.io";
  if (loginAuthority) {
    assertValidUrl(loginAuthority, "Authority");
  }
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
  let loginClientId = wantsClientCredentials ? (clientCredentialsClientId ?? "") : deviceClientId;
  if (!wantsClientCredentials) {
    loginClientId = deviceClientId;
  } else if (!loginClientId) {
    loginClientId = clientCredentialsClientId ?? "";
  }
  const shouldPersistClientId = wantsClientCredentials
    ? Boolean(loginClientId)
    : Boolean(options.clientId);
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
    const entered = await promptSecret("Client secret: ");
    loginClientSecret = entered;
  }
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
