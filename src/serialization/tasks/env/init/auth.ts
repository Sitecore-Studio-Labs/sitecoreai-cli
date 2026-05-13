import { openBrowser } from "@/shared/browser";
import { assertValidUrl } from "@/shared/validate";
import { createScaiError } from "@/shared/errors";
import { getDeployToken } from "@/shared/keychain";
import { assertInteractive, promptConfirm, promptSecret, promptText } from "@/shared/prompt";
import {
  requestClientCredentialsToken,
  requestDeviceAuthorization,
  pollDeviceToken,
} from "@/serialization/sitecore-api";
import type { EnvironmentConfiguration } from "@/config";
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
  updated: EnvironmentConfiguration;
  logger: Logger;
};

type ResolveDeployAuthResult = {
  deployToken?: string;
  loginAuthority: string;
  loginClientId?: string;
  wantsClientCredentials: boolean;
  shouldPersistClientId: boolean;
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
    updated,
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
  let loginClientSecret =
    options.clientSecret ??
    baseEnv.clientSecret ??
    existing.clientSecret ??
    process.env.SITECOREAI_CLIENT_SECRET;
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
  const deployAudience = "https://api.sitecorecloud.io";

  if (needsDeployToken && !deployToken && wantsClientCredentials) {
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
        audience: deployAudience,
      },
      undefined
    );
    deployToken = token.accessToken;
    updated.deployTokenExpiresIn = token.expiresIn ?? null;
    updated.deployTokenLastUpdated = new Date().toISOString();
  } else if (needsDeployToken && !deployToken) {
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
        audience: deployAudience,
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
        audience: deployAudience,
      },
      device
    );
    deployToken = token.accessToken;
    updated.deployTokenExpiresIn = token.expiresIn ?? null;
    updated.deployTokenLastUpdated = new Date().toISOString();
  }

  return {
    deployToken,
    loginAuthority,
    loginClientId,
    wantsClientCredentials,
    shouldPersistClientId,
  };
};
