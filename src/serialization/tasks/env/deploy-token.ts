import {
  readRootConfiguration,
  readRootConfigurationFile,
  writeRootConfigurationFile,
} from "@/config";
import { openBrowser } from "@/shared/browser";
import { assertValidUrl } from "@/shared/validate";
import { createCliError } from "@/shared/errors";
import { setDeployToken } from "@/shared/keychain";
import { assertInteractive, promptConfirm, promptSecret, promptText } from "@/shared/prompt";
import {
  requestClientCredentialsToken,
  requestDeviceAuthorization,
  pollDeviceToken,
} from "@/serialization/sitecore-api";
import { inputError, toLogger } from "../shared";
import type { DeployTokenOptions } from "../types";
import { DEFAULT_PUBLIC_CLIENT_ID } from "./constants";

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
    baseEnv.authority ?? process.env.SITECOREAI_AUTHORITY ?? "https://auth.sitecorecloud.io";
  if (baseAuthority) {
    assertValidUrl(baseAuthority, "Authority");
  }
  const deviceDefaultClientId =
    options.clientId ?? process.env.SITECOREAI_CLIENT_ID ?? DEFAULT_PUBLIC_CLIENT_ID;
  const clientCredentialsDefaultClientId =
    options.clientId ?? baseEnv.clientId ?? process.env.SITECOREAI_CLIENT_ID;
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

  const authority = baseAuthority;

  let clientId = wantsClientCredentials ? clientCredentialsDefaultClientId : deviceDefaultClientId;
  let clientSecret = options.clientSecret ?? baseEnv.clientSecret;
  if (wantsClientCredentials) {
    if (!clientId && isInteractive) {
      clientId = await promptText("Client ID");
    }
    if (!clientSecret) {
      if (!isInteractive) {
        throw createCliError(
          "Client ID and client secret are required for client credentials.",
          "INPUT_INVALID",
          {
            hint: "Provide --client-id/--client-secret with --use-client-credentials, or set SITECOREAI_CLIENT_ID and SITECOREAI_CLIENT_SECRET.",
          }
        );
      }
      const entered = await promptSecret("Client secret: ");
      clientSecret = entered;
    }
  }
  const audience = baseEnv.audience ?? "https://api.sitecorecloud.io";

  let token: { accessToken: string; expiresIn?: number };
  if (wantsClientCredentials) {
    if (!authority || !clientId || !clientSecret) {
      throw createCliError(
        "Client ID and client secret are required for client credentials.",
        "AUTH_REQUIRED",
        {
          hint: "Provide --client-id/--client-secret with --use-client-credentials, or set SITECOREAI_CLIENT_ID and SITECOREAI_CLIENT_SECRET.",
        }
      );
    }
    token = await requestClientCredentialsToken(
      {
        authority: authority ?? "",
        clientId,
        clientSecret: clientSecret ?? "",
        audience,
      },
      undefined
    );
  } else {
    if (!authority || !clientId) {
      throw createCliError("Client ID is required for interactive login.", "AUTH_REQUIRED", {
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
        authority,
        clientId,
        clientSecret,
        audience,
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
    token = await pollDeviceToken(
      {
        authority,
        clientId,
        clientSecret,
        audience,
      },
      device
    );
  }

  const stored = await setDeployToken(envName, token.accessToken);
  if (!stored) {
    logger.warn(
      "Unable to store the Deploy token in the OS keychain. Use SITECOREAI_DEPLOY_TOKEN if needed.",
      "yellow"
    );
  }
  const updated = {
    ...existing,
    deployToken: undefined,
    deployTokenExpiresIn: token.expiresIn ?? null,
    deployTokenLastUpdated: new Date().toISOString(),
  };
  if (wantsClientCredentials && clientId) {
    updated.clientId = clientId;
  }
  envProfiles[envName] = updated;
  rootConfigFile.config.envProfiles = envProfiles;
  writeRootConfigurationFile(configPath, rootConfigFile.config);

  logger.info(
    `SitecoreAI access token saved to the OS keychain for environment '${envName}' (Deploy + CM/admin scopes).`,
    "green"
  );
  if (options.print) {
    // Intentional: allows piping token in automated environments.
    console.log(token.accessToken);
  }
};
